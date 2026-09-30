# Circinus Mod Manager — working notes

Standing decisions and context that outlive any one session. Keep it short; if something here
stops being true, change it rather than adding a second answer.

## What this is

A RimWorld mod manager: Tauri 2 shell, Svelte 5 (runes) front end, Rust `circinus-core` for
everything that knows about mods. Original clean-room implementation, MIT. File formats, XML
tags, JSON schemas and Steam endpoints are shared with RimSort and RimPy on purpose, so lists and
rule databases interoperate; none of the code is theirs.

## Commits

Authored `Circinus <noreply@circinus.sh>` deliberately — no personal identifiers in the public
history. GitHub shows these as "Unverified"; that is the accepted cost, and a hook that asks for
them to be re-authored to `noreply@anthropic.com` has been declined twice. Do not re-author.

Commit messages end with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: <the session URL>
```

The session runs in a cloud container; the repo also lives at `D:\CircinusModManager` on the
user's PC, which is where pushes happen. Deliver changed files there (SendUserFile →
`device_commit_files`); do not expect to push from here.

## circinus.sh

`circinus.sh` is the project's site; it already serves the performance weights the Cost column
uses. It also takes build uploads and serves the auto-update feed, both of which are live: builds go up
through four calls under `/api/v1/ci/releases/…` with a `cmk_` build key, and an installed copy
reads `/api/v1/releases/latest.json`. The site chose Tauri's **static** feed format rather than
the per-copy dynamic route this repo specified, so `tauri.conf.json` lists both endpoints in
order and the app takes whichever answers. `docs/update-feed.md` describes both and is the record
of what is actually served; `tools/push-build.mjs` is the whole push and the release workflow
runs it on a tag, given the `CIRCINUS_BUILD_KEY` secret. The site refuses Intel Macs and em
dashes in release notes, so the workflow builds no Intel Mac and the script flattens the dashes.

The updater's private key is `/home/claude/circinus-updater.key`, outside the repo, meant for the
`TAURI_SIGNING_PRIVATE_KEY` secret; only the public key is committed. It can never be rotated
without one manual reinstall for everyone, since an app carries the public key it was built with.

A development build does not check, and refuses to install. The version on `main` is a
placeholder — the real one is set on the release commit, which belongs to the tag — so a build
made from the branch says 0.1.0 and every release ever served looks newer than it. That put an
update banner in every `npm run tauri dev` a few seconds after launch, and pressing Install on it
runs the real installer over the machine being developed on. `tauri::is_dev()` is the guard, and
`updater::DEV_BUILD` is what it says instead.

## Shape of the thing

- `circinus-core`: `scan` (two-phase: About.xml quickly, folder contents in the background,
  sqlite cache keyed by a stamp that includes `PARSER_VERSION`), `order` (HALO), `rules`,
  `modsconfig`, `dds`, `textures`, `loadcost`, `playerlog`, `defs`, `harmony`, `steam`.
- HALO — Harmonized Automated Load Order. Eight phases in load order: Prepatch (shown as
  "Preloads"), Core ("Game and DLC"), Framework ("Libraries"), Content, Patch ("Patches"),
  Texture ("Texture packs"), Late ("Late loaders"), Optimization ("Performance"). Rules are hard
  DAG edges, phases are soft, and a real cycle is explained and cut rather than fatal. The HALO
  page lets a user switch built-in rules off or send them to another phase. *What changes* compares
  the order you have with the one HALO proposes as a diff rather than as two lists: the longest run
  of mods that keep their relative order is the backbone, and only the mods lifted out of it are
  moves. The rest is drift, and saying so is the point. Those moves are then shown as what leaves
  each phase beside what arrives in each, with one weighted arrow per journey — chosen from five
  mockups, because a row-by-row comparison of a thousand-mod list is unreadable however it is
  drawn (`src/lib/moves.ts`, `MovesView.svelte`).
- **Precedence: you > the author > the databases > HALO.** `RuleSource`'s declared order *is* the
  precedence system — `Ord` is derived from it, the contradiction resolver compares on it, and the
  cycle cutter drops the `min`. About.xml is the file the game itself sorts by and its author is
  the authority on their own mod, so nothing Circinus infers may outrank it. The databases sit
  below the author because they are other people's read of somebody else's mod and they ship off.
  HALO is last because everything at that rung is a guess. It used to be first, which is how a
  guess came to beat a declaration and how an author's own rule became the first thing cut out of
  a loop.
- Fluffy's `About/Manifest.xml` is not a tier. The game never reads it, its identifiers are
  free-form strings resolved through a lowercased folder-name lookup, and its load-order fields
  were bolted onto a version-check file. HALO reads it when a mod ships one and files what it
  finds at the HALO rung, where a fuzzy match can only ever produce the weakest edge in the graph.
- The official-content rule is a rule for silence. Anything that ships Defs loads after Core and
  the DLC *when nobody has said otherwise* — that is the drift vanilla's depth-first sort causes
  on its own, and the reason the rule exists. It was never an argument for overruling a person, so
  an author, a database in use, a user rule or the user filing a mod under Prepatch all put it
  above the game, Defs and all. `validate` then reports `AboveOfficial` with `declared: true`, a
  warning about what the placement may cost rather than an error about a list nobody chose: a mod
  whose defs inherit nothing from the game loads up there perfectly well, and only its author
  knows. Undeclared, it stays an error.
- `PREPATCH_IDS` is a set, not a sequence. There used to be an order in it, pushed in as hard
  edges labelled "the order their own pages ask for". Prepatcher's page says the opposite in as
  many words: "Its placement relative to Harmony doesn't matter, it can be put below or above it."
  Being in the set puts a mod in the Prepatch phase, which is what floats it; among mods no rule
  separates the order stays the player's.
- Bands of your own. `settings.halo_advanced` (off by default) reveals a card on the HALO page
  for making a band that holds its own place in the load order, after a phase you choose. There
  is no ninth `Phase` behind it and there does not need to be: a group with `section: true` and a
  `phase` already *is* one — `section_rank` orders the bands that follow the same phase, and the
  sort key is `(phase, section_rank, key)`. So this is a page onto machinery that worked, not a
  model change, and rules still hold across a band's edges like any other.
  An empty band draws no heading (`layout` skips a section with no members), which is deliberate:
  a heading over nothing is noise. `store.addBand` exists because `addGroup` then `updateGroup`
  are two round trips and the second starts from a user snapshot without the new group in it, so
  the band silently never got its section — anything setting a group's fields at birth goes there.
- New mods: `arrivals` records when Circinus first saw each folder, durably and per instance,
  because `changes` retakes its baseline on every scan and a mark on a row has to outlive the
  rescan the eight second folder poll runs a moment later. The first record stamps everything 0
  ("already here"), so a first run announces nothing; a mark fades after 14 days or when the user
  says they have seen it. The list marks them green on the *right* edge, since amber on the left
  already means HALO would move this and one row can be both. There is a New tab, shown only when
  something is in it.
- The list's measures: **Time** is the seconds a mod is expected to add to loading, **Load** the
  same estimate as a share of the list, **Cost** its frame-time share from circinus.sh. Time and
  Load come from one number (`contents.load.scoreMs`) so they always agree; only Load is
  coloured, since colouring both would draw one fact twice. All three are estimates from what the
  folder holds, and every tooltip says so. **Median** is the fourth and the only one that is not
  an estimate: what the mod typically adds to a start-up on *other people's* machines, measured
  by Loading Progress and pooled by circinus.sh (`Weight::load_ms_median`). It is wall-clock
  milliseconds spent once, so it is never added to Cost and never compared with it, and a mod
  nobody has timed shows a dash — the site sends `-1` for that and a zero there would be a
  measurement nobody took.
- **One notice column, and severity decides what it shows.** There used to be six columns of
  icons (Changed, Update, Errors, Warning, Notes, Pinned) costing 232px of every row for ever,
  and the reader still had to scan all six to answer one question. Now there is one mark, it
  shows the most serious thing the row carries, and the 190px goes to the mod name.
  `src/lib/notices.ts` holds the whole rule and is deliberately free of runes, the store and
  Svelte, so "which of these seven is the one to show" can be tested without rendering a row.
  `NOTICE_ORDER` *is* the ranking; nothing else defines it. A pinned mod with an error shows the
  error, and the mock pins one that has an error so `notices.cjs` can prove it — a corpus where
  no row holds two notices cannot tell a correct ranking from a broken one.
  **Dismissal hides the mark and nothing else.** The Analyzer still lists every issue, because
  it is the complete index and one that quietly drops rows is worse than none; this is the
  bargain `muted` already makes for incompatible pairs, and the reasoning in that entry applies
  here word for word. The popover shows what has been put down and offers it straight back, and
  Settings has the same offer in bulk — a dismissal nobody can find again is a memory hole
  rather than a preference. A pin is the one notice that cannot be dismissed: it is a thing the
  user did, so the button unpins instead.
  Keys are `<packageId>|<kind>|<token>`, on the package id like `muted` so a resubscribe does
  not undo the decision. **The token is what stops a dismissal outliving its subject**: "I have
  seen this update" means *this* update, so the token is the author's publish time and the next
  release raises the mark again. A standing condition has no token and stays down until brought
  back.
- Where the window opens is a setting, and it is applied **once**, on the first snapshot
  (`applyOpeningPreferences`). Re-applying it on a later snapshot would drag somebody back to
  the load order every time settings were saved. A `defaultView` or `defaultSort` this build
  does not have falls through to the load order rather than failing, because settings written
  by a newer Circinus must not be able to open a window onto nothing. The mock seeds both from
  the query string (`?open=loadtimes&sort=name`), since its settings live in a module and a
  reload throws away whatever the window wrote — "set it, restart, check" is not something the
  browser mock can do.
- Sorting: any column heading orders the list, and the Sort menu in the toolbar offers the same
  keys plus the ones that are not columns — date modified, date updated on Steam, Steam id. The
  load order is the default and the only real one. Sorting `visibleActive` rather than the
  sections is what makes "by phase" sort within each section for free, since `layout` builds
  sections by filtering. Dragging is refused while sorted — a drop between two rows of a list
  sorted by name writes a position nobody chose. `SORTS` is the one list both the menu and the
  headings read, and `ASCENDING_FIRST` decides which keys open A to Z rather than largest first.
- `ModInfo::updated` is Steam's `timeupdated` on its own; `modified` stays the newest of the
  folder mtime, About.xml's mtime and that same Steam date, because the change detector and the
  cache stamp need "when did the content last change". Sorting wants them apart: "my files
  changed" and "the author shipped something" are different questions. A mod Steam has never
  updated has `updated` 0, which sorts as no answer rather than as 1970. `PARSER_VERSION` 5 is
  what re-reads every cached mod so the field is populated instead of defaulting to zero.
- macOS paths: RimWorld is `RimWorldMac.app`, and the Finder treats a `.app` as a file, so a
  folder picker only ever offers the folder it sits in. `paths::game_root` resolves that folder
  to the bundle, and everything (Version.txt, Data, Mods, the executable, Steam detection) asks
  through it. The game's Data is `<app>/Data`, holding Core and the DLC; `Contents/Resources/Data`
  is Unity's and preferring it by name is what hid Core. Both candidates are tried and the one
  with Core in it wins. None of this is behind `cfg!(target_os = "macos")` on purpose: a rule
  that only runs where the tests cannot is a rule nobody checks.
- `dds` quality is two settings, not four. `High` and `Max` were the ISPC `alpha_basic` and
  `alpha_slow` BC7 modes; `examples/dds_bench.rs` measured them against Balanced at 2.1x and 8x
  the time for 0.0-0.1 dB, which nothing on screen can show — a 2048-square atlas took 41 seconds
  at Max against 5 at Balanced for the same picture. `Balanced` carries `serde(alias)` for both
  old names so an older settings file still loads and is written back under the new one; without
  that, one unknown word fails the whole settings file and the player opens a Circinus that has
  forgotten their folders. Quality changes nothing for an opaque texture (BC1 has one mode) and
  never changes a file's size (a BC7 block is a fixed 16 bytes), which the Textures view now says.
- `dds`: a texture is flipped vertically before it is encoded (`Options::vflip`). A DDS stores
  its first row at the top, Unity takes the first row it is handed as the *bottom* one, so a file
  written the natural way is upside down in the game — which is what `-vf` is doing in the todds
  recipe the community uses. `validate` cannot catch this: it compares the decoded file against
  the very image the encoder fed to the block encoder, so it is blind to which way up that was,
  and it passed every inverted file the first version wrote. The test
  `a_texture_is_stored_bottom_row_first` is what holds the convention. One path asks for no flip:
  rebuilding a broken DDS that has no PNG beside it starts from pixels decoded out of a DDS, which
  are already the way round the game wants. `PARAMS_VERSION` is how a fix reaches files already on
  disk — `job::plan` re-converts anything the manifest says was encoded by an older set of rules.
- Keeping your place. `App.svelte` picks a view with `{#if}`, so leaving one destroys the
  component and everything local to it; coming back mounts a fresh one at the top. Halfway down a
  thousand-mod list that is the whole position gone for looking at one group, and it did the same
  in the Defs and Patches reports. `store.scrollMemory` outlives the component: keyed by scope
  ("order:main", "order:inactive", "defs", "patches:<tab>"), and deliberately not `$state`, since
  it is written on every scroll event and read once on mount. The list remembers the *row* under
  the top of the window rather than the pixel — a pixel is only right if the list is identical when
  you come back, and a filter or an activation makes it not — and falls back to the raw offset when
  that row has gone. `tools/loadtest/scroll.cjs` scrolls, leaves, returns and asserts the same row
  is at the same height.
- The patch report is four screens, not one page. It answers four different questions — what two
  mods are fighting over, every method anything patches, what each mod patches, and what patches in
  a way static reading cannot follow — and each answer is a list of hundreds or thousands. Stacked
  on one page the fourth was a thousand rows of scrolling from the first, and the long ones were
  cut at 120 and 400 rows with a line apologising for the rest. Cutting is the wrong answer to a
  list being long: the row somebody wants is as likely to be the two thousandth as the second. So
  each is a tab, each is complete, and "every patched method" means every one — contested included,
  since an index that quietly leaves out the interesting rows is not an index. That list is
  virtualised the way `ModList` is (fixed 33px rows, full-height box, a screenful drawn), because
  three thousand rows of markup is what the 400-row cut was really about. The title, the read
  button and the tab bar sit outside the scroller so they stay put, and each tab scrolls in a
  scroller of its own (`{#key tab}`) with its own entry in `scrollMemory` — sharing one meant the
  browser clamping the old position against the new tab's height and writing that over the place
  the new tab was left at. Which tab, the filter text, the open mod and the table's sort live on
  `store` for the same reason the scroll position does: clicking a mod here *is* a view switch, so
  everything local to the component is thrown away on the way to it. `tools/loadtest/patches.cjs`
  covers all of it, and the mock carries a synthetic bulk of patches on top of its named ones
  because thirty targets cannot show whether a window over three thousand rows lines up.
- Keys are a table, not a chain. `src/lib/keys.svelte.ts` holds every action as
  `{ id, section, name, keys, enabled, run }`; `src/lib/chord.ts` is the rules for reading a
  keystroke, kept rune-free and store-free so it can be bundled and tested directly, with the
  platform as a parameter rather than a sniffed global (which is the only way this machine can
  check what a Mac would be told to press). The chain it replaces could not be enumerated, so F8
  walked the review list and was advertised nowhere; could not be labelled, so five components
  carried "Ctrl S" as a literal and a Mac was told to press Ctrl; and duplicated its own actions,
  the Downloads toggle existing character for character in two files.
  Matching is *exact*. `ctrlKey || metaKey` with nothing said about the rest is why Ctrl+Shift+I
  — devtools, on every browser there is — opened the Import dialog. A chord that does not name a
  modifier requires it to be up. Shift is the exception: a single character that is not a
  lowercase letter carries Shift in itself, so `?` binds as `?`.
  The guard is about the keystroke, not the element. The old one returned early for any INPUT,
  which is why Escape did nothing in the search box and Ctrl+S did not save while you were
  typing. A chord is safe in a text field; a bare key is not.
- Escape belongs to whatever is on top. It used to be five `svelte:window` listeners in five
  files, each closing its own local boolean and none stopping the others, so closing the sort
  menu also cleared the selection behind it and — worse — silently discarded a HALO preview, on
  the most-pressed key in the application. `store.onEscape(id, rank, open, close)` registers;
  `store.escape()` closes the highest-ranked open thing and stops. Ranks: context menu 60,
  palette 50, dropdown menus 40, dialogs 30. Import and Collection had no Escape at all before
  this, and a bare Escape no longer touches a preview.
- The list is a listbox with a roving tabindex, and the keys live on the container rather than on
  each row. Both parts matter: every row being `tabindex="0"` made Tab walk a thousand of them,
  and real DOM focus on a *virtualised* row is destroyed the moment it scrolls out — which is why
  arrow keys stopped working after any wheel scroll, the row that had focus having ceased to
  exist. `cursor` keeps the uid, which outlives the element; `aria-activedescendant` says where
  it is. Rows keep a handler as well only because `key` stops propagation on anything it handles,
  so the two never both fire. It bails on Alt outright: Alt+Arrow is "move the mods" and belongs
  to one handler, not to two that each did half of it.
- The palette (`Mod+Shift+P`) is the honest answer to reaching things by keyboard: thirty chords
  is thirty things to memorise and thirty chances to collide with something the webview wants.
  Every row shows its own binding, so finding a command is also how its shortcut is learnt, and
  an unavailable one is greyed rather than hidden — a command that quietly stops matching sends
  somebody looking for a word that no longer exists. `ShortcutsDialog` (`?`) is the same table as
  a reference. Neither can disagree with the handler, because there is one table.
- What a curator said. A followed collection reports *what* changed — these mods arrived, those
  left — and can say nothing about why, or that a save needs a mod removed before it will load.
  Curators say that on Discord, and a player who follows the pack here and not there never hears
  it. So the app reads a feed per followed collection from circinus.sh (`announce.rs`), and
  deliberately knows nothing about Discord: no account, no token, nothing to hold. Whatever
  writes the feed on the far side can change without an app release, and `docs/announcements.md`
  is the contract plus the intended writer (a bot in the *curator's* server, publishing through
  an `/announce` slash command — which needs no Message Content intent at any scale, and makes
  publishing an act rather than a channel that quietly ships everything said in it).
  **Every failure is an empty list.** The endpoint is not served yet, so every copy of 1.4.0
  ships into the empty case, and `?nopacks` in the mock is that case: no banner, nothing in the
  sidebar, no toast. A curator's note is never worth an error in front of somebody trying to
  launch a game.
  The text is somebody else's and the screen says so — the author on every post, a line saying
  Circinus passes these along without checking them, rendered as text and never as markup, and a
  `link` dropped unless it is `https://`. Unread is per pack, so catching up on one curator does
  not silence another; muting one is separate from unfollowing the pack, and the sidebar keeps
  offering the way in on an empty feed because the unmute rows live inside that panel.
- Followed packs refresh themselves. `packs.rs` asks twenty seconds after launch and every six
  hours: what each collection holds, and what its curator has said. Unlike `watch.rs`, which
  polls four local mtimes every eight seconds because a stat call costs nothing — this one goes
  over the network to two services that owe us nothing, for a signal that moves maybe weekly, so
  it is slow, sequential and silent about every failure. It is banner-only for the same reason: a
  mod changing under a running game is worth interrupting for, a note about it is not. It reads
  Steam's `time_updated` — stored since collections were added and never read until now — to skip
  the expensive call when a collection cannot have changed, and it never touches `known`, which
  is the user's own "I have seen this" mark and would be silently swallowed by the poll that
  found the change.
- Open folder opens *that* folder. The opener plugin has two calls and they are easy to swap:
  `openPath` opens the thing itself, `revealItemInDir` opens the folder containing it with the
  thing selected. Every "Open folder" in the app used reveal, so asking for a mod's folder opened
  the Mods folder with the mod highlighted — one level above what was asked for, which in a folder
  of five hundred mods is not a small difference. Folders open, files still reveal (a log, an
  executable: seeing it among its neighbours is the point). `store.openFolder` is the one place,
  because the folder can be gone — unsubscribed, drive unplugged — and a button that does nothing
  when pressed is worse than one that says why.
  **It goes through our own `open_folder` command, not the plugin's `open_path`.** The first
  version called the plugin from the window, on the strength of `opener:allow-open-path` already
  being in the capability file. That permission enables the command and grants it an *empty*
  scope, and `is_path_allowed` on an empty scope is false for every path, so the button failed
  for every user on every machine. Reading a permission's name is not reading what it permits.
  Rust also gets to check `is_dir` first, which the plugin call could not: `open_path` hands a
  path to the system's default handler, the default handler for an executable is to run it, and a
  mod folder can contain links its author chose. Widening the scope to `**` would have worked and
  would also have handed the window that.
  The other half of the lesson is that `tools/loadtest/openfolder.cjs` passed the whole time. The
  browser mock short-circuits before the call, so it proved the call site and could never prove
  the call. `tools/commands-check.mjs` (part of `npm run check`) is what covers the gap: every
  `invoke` in `api.ts` names a command in `generate_handler!`, and reaching for the plugin's
  `openPath` from the window fails outright.
  A failure now says what actually happened. The first version caught every error and printed
  "it may have been moved or removed", which was a guess, and the guess was wrong: it sent people
  to look at a folder sitting exactly where they left it. Errors name the thing that went wrong.
- A key made by gluing two fields together is not a key. Svelte treats a repeated key in a keyed
  `{#each}` as fatal — the block throws, the boundary catches it, and the whole screen becomes an
  error page — so a key that is *usually* unique is a screen that usually works. The Defs report
  keyed its overwrite chains on `(c.def + c.path)`, which identifies a chain right up until two
  mods overwrite the same field of the same def. That is ordinary on a real load order and absent
  from a forty-mod mock, so the report was unreachable for anybody actually using it while every
  check passed. These report rows are keyed by position now, which is honest: they are replaced
  wholesale whenever the report changes, so position *is* their identity. What is open is keyed
  by position too, and reset when a filter moves the rows — before, opening one of two rows that
  read the same opened both. `tools/each-key-check.mjs` (part of `npm run check`) refuses a key
  built by concatenation unless it includes the block's own index, and the mock now carries two
  chains that agree on def and path so `tools/loadtest/defs.cjs` fails without the fix.
- How long the game takes to start, in the summary strip. Two different numbers, and saying which
  is which is the whole feature. `playerlog::load_run_of` reads the game's own log for a real
  measurement: RimWorld never times itself, but Prepatcher prints the vanilla load and the
  def-cache mods print their pipeline, so a figure is there for most lists big enough to care.
  The longest reported stage wins, because these stages nest and the outermost is closest to what
  a player calls loading, and `source` carries whoever measured it — the card names them, since
  this is somebody else's number and passing it off as Circinus's own would be a lie about where
  it came from. It is read at launch from paths taken under the lock and files read outside it: a
  Player.log runs to tens of megabytes.
  With no measurement the card shows the model, and says so. `loadcost::score` sums *mods*, so a
  total built from it alone is short by however long RimWorld takes to start on its own — the
  larger half of the number on a small list. `VANILLA_SECS` is the stand-in until a log carries
  Prepatcher's real figure, deliberately round so nobody reads it as measured. The card also
  notices when the measurement was taken with a different list than the one on screen.
- The summary strip is **one row at every width**, and the cards give way instead of the grid
  wrapping. A second row is not free: it costs the mod list under it about 113 pixels, at every
  width, for ever, and the list is what the window is for. Two loadtests failed the moment the
  strip first took a second row, which is how that cost got measured rather than argued about.
  So each card is its own container and sheds what it can afford as it narrows — padding, then
  type size, then the flag icon. What it never sheds is the caption, because on the load-time
  card that word is "Measured" or "Estimated", the difference between a fact and a model. It
  wraps to as many lines as it needs and is never clamped: an ellipsis eats the half of a caption
  that says what the number *means* — "Measured yesterday, from…" loses the name of whoever
  measured it — and a sentence you have to hover to finish is not a sentence the card said. Cards
  in a row are as tall as the tallest, so the strip grows a little at narrow widths (about 30px
  below 900) instead. That is cheap; a second row is not. `stats.cjs` asserts at every swept width
  that no label or caption is cut, vertically or horizontally.
  Two traps here, both paid for once. A container query matches *descendants* of a container, so
  `.stats` carrying `container-type` and then querying `.stats` matched nothing — the breakpoint
  that file declared had never fired, which is why the wrapper `.strip` exists. And the query
  measures the **content** box, 28px narrower than the card at this padding, so thresholds read
  as card widths fire about 30px early; that is what once clamped the caption at a width where
  two lines cost nothing.
- **The Directory layout, and the three papers.** There is no title bar. One fixed 266px column —
  the site's own `--dirw` — is the whole navigation: wordmark, instance, views, groups,
  collections, then the status marks and Save/Play/theme at its foot. It lives outside the view
  switch in `App.svelte` because it is the constant; only what sits beside it changes. Search is
  a line at the top of the content column, which is the one control that acts on the content.
  The column is a **grid**, not a flex column, with one scrolling row in the middle:
  `margin-top: auto` cannot pin a foot inside a scrolling box — it scrolls away with everything
  else, which is how Save and Play ended up below the fold on a short window.
  Neither paper is invented here. Dark is circinus.sh's `:root`; light is an e-ink step of its
  light set, pulled off white in both directions (ground down to `#e4e1d9`, ink up to `#26241f`)
  so the range closes to about 11.9:1 the way a reflective panel's does. **Every colour is a
  token defined in one of those two blocks in `app.css`.** A literal hex in a component is a
  colour that only works on one paper, and that is the bug this structure exists to prevent —
  `#f2ad4a`, `#b8433c` and `rgba(11,11,13,.7)` were all found that way.
  `lib/theme.svelte.ts` owns the choice; it writes `data-theme` on `<html>` (not a wrapper, or
  the scrollbars and form controls keep the other `color-scheme`) and remembers it in
  localStorage, never in user data — a list moved between machines must not drag a theme with it.
  `index.html` repeats that read in a tiny inline script so the window never flashes the other
  paper before the bundle lands; **keep both keys in step with the module.**
  The third is **OLED**, and it is a *variant of dark rather than a third choice beside the other
  two*. `theme.paper` is light or dark and is what the toggle flips; `theme.darkVariant` decides
  which dark and is a setting. Making it a third value of one enum would have turned the toggle
  into a three-state cycle, so somebody glancing at the paper and coming back would land
  somewhere they did not start. Only two things move from the dark set: the ground goes to `#000`
  so the pixels are off rather than dim, and every rule is lifted one step, because a 1px
  separator at `#2a2723` that reads over `#131210` disappears over black and the whole layout is
  held together by rules. The ink stays the same bone — pure white on pure black is what makes
  text smear when an OLED panel scrolls, and `#ece7de` is already 17.05:1 there, more than the
  normal dark set has. The group hues are untouched and every one of them *gains* contrast on the
  darker ground, so the three rules they were solved for still hold.
- **Every corner is 0, written literally, and there are no radius tokens.** The four that used to
  exist were all 0 and the rounding had drifted back in as literals anyway: eight different px
  values across twenty-five files, so a button was square in one panel and rounded in the next.
  A token whose only value is 0 invites somebody to give it a second one. The exceptions are
  round because they are circles, not because they are soft — the small status dots (`.dot`,
  `.newdot`, the save mark, a `::before` bullet) and the two spinners. circinus.sh's own
  stylesheet makes the same call and has exactly one `50%` in it. `loadtimes.cjs` walks every
  button, chip, pill, input, card and switch in the window and fails on a computed radius that is
  not `0px`.
- **Colour means an error, with one exception.** Two accents: `--amber` is the site's `--hold`,
  `--red` its `--bad`. Everything advisory carries its weight in words and ink — the five weight
  bands are mono inside a rule, banners are quiet panels with a 3px coloured edge, and `.pos` is
  ink rather than green, because a "good" colour spends attention saying nothing happened. Only
  an error keeps a fill.
  The exception is **groups**, because a group is identity and not severity, and that is the one
  place hue does real work. Seven families solved against three rules at once: every pair at
  least 15 ΔE apart in OKLab, every one at least 15 from *both* accents so a group can never be
  mistaken for an error, and every one at least 3:1 on its own ground. Dark clears all three
  (15.7 / 16.8 / 3.14); paper lands slightly under on the first two (14.7 / 14.9 / 3.13), which
  is the medium rather than the values — a light ground forces dark marks, dark marks have less
  chroma to spend, and `--red` is itself a dark brick sitting in the middle of the range.
  Two things to know before touching `--g-*`. The keys (`blue`, `amber`, `coral`…) are the
  strings already in user data, **not descriptions** — `--g-amber` is not amber, and renaming a
  key silently repaints every group that has it. And `.c-<name>` is a *group slot*, so a meter or
  a badge that borrows `.c-amber` for a tint picks up a group's hue; meters take `--bar`, or
  `.c-red` when the thing they measure is an error. Chroma has a floor around 0.10 in OKLCH:
  below it a hue stops reading as a hue, so "more muted" is not available without losing the
  identity the slot exists for.
  None of this is colourblind-safe and no seven-hue set is — under deuteranopia the worst pair
  collapses to about 4 ΔE. It is acceptable only because the group name is always printed beside
  its dot. **A dot without its name is the bug**, not the palette.
- **The load-time card has three kinds of number, and must always say which.** A per-mod
  measurement from `ilyvion.LoadingProgress` (`StartupImpactData.xml`, beside Player.log in the
  save-data folder); the game's own log, which gives a total and no breakdown; and
  `loadcost::score`, the model. They are worth different amounts and the caption is where that
  is said — a figure built from thirty measurements and fourteen guesses is an *estimate*, and
  a card calling it "Measured" is lying in 17px bold. `stats.cjs` asserts all three captions.
  The measurement does not replace the model, it corrects it: `loadcost::calibration` divides
  what the measured mods really cost by what the model said they would, and that factor is
  applied to the mods that have never been measured. Floors at five overlapping mods and 500
  modelled ms — below either the ratio is one outlier — and clamps to 0.2–5×, because a factor
  outside that is a mismatched file rather than a slow disk. `store.expectedMsOf` is the single
  per-mod figure this produces; the Time column and the shares both come from it, so they can
  never disagree.
  Everything in that XML is **float milliseconds**. Scaling it twice is off by a thousand and
  looks plausible. The mod's two tracking settings are **off out of the box**, so absent is the
  normal case; the tooltip names both boxes rather than showing nothing. The file holds one
  session and is overwritten each launch.
  `logs::refresh_last_run` reads both records, stats before it reads (a Player.log is tens of
  megabytes and reading it to learn nothing is the most expensive way to learn nothing), and
  takes paths out under the lock before touching a file. It runs at startup **and on window
  focus** — the game writes that figure while Circinus is not in front, so reading it only at
  launch meant playing, coming back, and being shown the run before the one you just did. There
  is a **Re-read** button as well (Load times, and Settings) for the path automatic reading
  cannot cover: the mod's two tracking settings are off out of the box, so somebody who has just
  switched them on has a file the window has no reason to think has changed, and "alt-tab twice"
  is not an answer.
- **The Load times page divides the machine out, and that is the whole feature.** It puts what
  Loading Progress measured here beside the median of what it measured on everyone else's
  machine, pooled by circinus.sh (`Weight::load_ms_median`, off the same `/api/v1/mods` fetch
  that already brings the frame shares; `-1` from the site means *below the floors* and `num`
  drops it to `None`, because a mod nobody timed must never read as a mod timed and found free).
  **Raw milliseconds do not compare across machines.** A slower disk makes every mod slower, so
  two columns of ms say one thing forty-four times and that thing is about the computer. The
  per-mod ratio has the same problem until you notice the machine *is* the median of those
  ratios — so `store.loadMachineFactor` is that median and the column worth sorting on is each
  mod's ratio divided by it. Everything that was only the disk lands at 1.0×; what is left is
  the mod. Same trick as `loadcost::calibration`, against a different baseline.
  A missing figure is **never** a zero and never sorts as one: a null sorts last, not fastest.
  `loadtimes.cjs` plants two outliers in a corpus made uniformly 1.3× the pooled median and
  fails unless exactly those two rise and everything else reads 1.0×, which is the assertion a
  page comparing raw milliseconds cannot pass.
  The site publishes `loadRatioMedian` in its rollup but does **not** serialise it yet; that is
  the figure that would make this comparison exact rather than inferred, so take it when it
  appears.
- **The save confirmation compares; it does not remember.** `dirty` is a sticky flag set by
  every edit and cleared only by a write, so it stays true after you activate a mod and
  deactivate it again. `App::pending_save` runs `modsconfig::build` without writing and diffs
  the result against `file_active`, which needs no new state and makes the dialog the one thing
  in the app that can say "nothing to write". It breaks the change into activated, deactivated
  and moved, because those are three different risks: a removal is the one that can lose you
  something, so it is the only one carrying colour.
  Play does **not** go through it. `launch_game` saves in Rust when `launch.save_first` is on,
  and a modal between the button and the game is the wrong place to ask a question; the toast
  says what was written instead.
- **Loading Progress measured it, and every surface says so.** `ilyvion.LoadingProgress` does
  all the per-mod timing; Circinus reads the file it writes and times nothing. The log path
  always named its source ("from DefLoadCache") and the two newer paths use *more* of that
  mod's work than the log does, so they name it too — `stats.cjs` asserts the caption carries
  it, and `sharing.cjs` asserts the consent card does. The README thanks it, `docs/telemetry.md`
  passes the obligation to the site, and `ADD-LOAD-COSTS.md` spells out where it appears there:
  the mod page block, `/meta`'s units prose, and the method page. Its licence (Apache-2.0 / MIT)
  asks for none of this. The alternative is a site quietly taking credit for a mod author's
  work, which is the opposite of what a site that refuses to call a mod bad is for.
- **Sharing is off until answered, and the answer is to a version.** `src-tauri/src/sharing.rs`
  holds the decision and the id; `crates/circinus-core/src/telemetry.rs` holds the envelope;
  `docs/telemetry.md` and `ADD-LOAD-COSTS.md` in the CircinusWeb workspace are the two halves of
  the contract. `src-tauri/src/outbox.rs` is the queue and the sender.
  **The spool is files on disk, not a list in memory**, because the endpoint does not exist
  yet: a build in the wild measures, queues, fails, and keeps the run, and the day the site
  answers everything held starts moving with no new release. Twenty runs kept, newest first —
  a month offline should not mean three hundred uploads, and the oldest describe a list that
  has since changed. `may_send()` is checked at enqueue *and* at send, because a run spooled
  under a yes must not go out after the player changed their mind; switching sharing off
  deletes the spool outright rather than letting it expire unsent.
  Status handling is one arm per code and not "not 2xx", because the distinction is the whole
  point: 400 and 413 will fail forever so the run is dropped, 422 means the agreement it was
  sent under is gone so the run is dropped *and* the stored consent is cleared, and everything
  else including a 404 from an endpoint that does not exist yet is "try later". Failure is
  always silent — a toast about a background upload is noise about a thing nobody can fix.
  No GPU in the payload. Loading is XML parsing, patches and disk; the graphics card explains
  none of the variance, and a field that explains nothing only makes an install easier to pick
  out. The analyzer sends one because frame time genuinely depends on it. **Every surface that
  lists what is sent has to say so**, and two of them said the opposite for a while: the consent
  card's `sharing.row.machine.v` listed an RTX 3070, and the site's privacy page listed a
  graphics card in the start-up table. Both now say no graphics card, in as many words, because
  overstating what you collect is the same kind of lie as understating it.
  The policy is the one already published at circinus.sh/privacy for the Performance Analyzer,
  word for word, because a second tool sending a slightly different set under the same promise
  would make the promise worthless. Three parts of it are mechanical rather than aspirational:
  `Sharing::default()` shares nothing and there is no path where it starts on; `answered()`
  compares against `telemetry::CONSENT_VERSION`, so a yes given to version 1 does not authorise
  a version 2 payload and the player is asked afresh; and **`build()` cannot see a path, a name
  or the filesystem** — it takes numbers and ids as arguments, so there is no line anyone can
  add later that leaks one. `no_path_can_reach_the_wire` and `no_mod_name_can_reach_the_wire`
  hold that shut and the privacy page says out loud that they run on every build.
  The source file is full of things that must not travel: `StartupImpactData.xml` carries a
  `modName` for every mod and is read from inside the player's home directory.
  **Two different reasons are at work in the omissions and conflating them makes a false
  claim.** The package id *identifies the mod* and is sent — anyone can read `brrainz.harmony`,
  and `workshopId` is there precisely so the site can resolve the real title. The display name
  is dropped for *quality* (an unverifiable typed string), not privacy, and no interface may
  imply the site cannot tell which mods a run contained: that is what the payload is for. What
  is dropped for *privacy* is everything describing the install rather than the mod — paths,
  source, the versions of unmeasured mods, and the load order. The order is genuinely gone
  rather than merely unused: `build` sorts the cost array by package id and `list_hash` hashes
  the sorted, deduplicated set, so two installs with the same mods in different orders send
  byte-identical payloads. `the_load_order_does_not_travel` holds that.
  **The install id is this tool's own, not the analyzer's.** A load cost and a frame cost meet
  on the mod's page by package id, which is the only join the site performs, so nothing needed
  the two tied at the machine. The consequence is two ids and two deletes, and Settings has to
  say so. It is minted lazily on the first yes — an install that never shares never has one —
  from the OS random source and nothing else, because the page claims it is not derived from
  hardware or an account and a hash of something real would break that.
  `may_send()` is the only gate anything should ask; a no is stored as an answer, because "said
  no" and "never asked" have to behave differently.
- **The icon set is cut paper.** One solid shape in `currentColor` and a second sheet behind it
  at 38% opacity; no strokes, no gradients, nothing on a grid finer than 3 units of 24, so no
  limb disappears at the 15px the directory uses. The previous set had its hues compiled in,
  which is why a second paper was impossible: every glyph had to be redrawn and none could take
  the ink of the thing it sat in. Only `error` and `warn` ever carry colour and they take it from
  the caller. Keys in `lib/icons.ts` are unchanged from the old set, so call sites still resolve.
- **A mod is replaced where it already lives** (reported as #2). Every SteamCMD download used
  to land in `Mods/<id>`, Force update of a subscribed mod included. With the same packageId in
  Mods and in Steam's folder RimWorld suffixes the *Workshop* copy `_steam`, so ModsConfig.xml's
  plain packageId names Circinus's copy: the game loads that one, Steam goes on updating a
  folder nothing reads, and the mod is frozen at whatever Force update fetched until somebody
  deletes it by hand. So `steamcmd::replace_workshop_copy` puts a subscribed mod back into
  Steam's own folder and `collect` keeps taking everything else into Mods. Three rules hold it
  safe: **never while Steam has a `downloads/<id>` or `temp/<id>` staging folder** for the item,
  because that is a process we do not control; **the old copy is moved aside, not deleted**, and
  moved back if the new one cannot be put in place, because a failed update must not uninstall
  a mod somebody is still subscribed to; and **Steam's `appworkshop_294100.acf` is never
  written** — the worst of leaving it alone is that Steam re-downloads later, which is a slow
  correct answer rather than a fast corrupt one. Parked copies go in the prefix's `replaced/`
  and never inside `content/`, where they would scan as a second mod with the same packageId.
- **A SteamCMD download is a real folder named after the Workshop id**, and nothing else
  (`PARSER_VERSION` 6). Carrying `About/PublishedFileId.txt` was the old test and was far too
  wide: mods track that file in their own repositories, so a developer's build of one was
  classified as a download, sat on the update list as permanently out of date, and was offered
  a Force update that would have written `Mods/<id>` beside it. The link check is part of the
  rule — a hash-named link to a workspace is how dev tools deploy a mod, and what it points at
  is somebody's working copy. `State::is_updatable` is the one place that decides what may be
  checked or force-updated, and it is Workshop and SteamCmd only; `workshop_ids` used to say
  that in its comment while returning every mod with an id.
- **A moved item must leave the workshop ACF, and `forget(&ids)` was not enough** (reported as
  #1). SteamCMD builds a download out of chunks it believes are on disk, so an item still listed
  as installed whose folder has moved makes a *later* download that shares a file with it fail
  while reading that chunk — and SteamCMD answers a read failure by validating the whole app,
  re-downloading every item still listed. One report had 9,797 files and 336 MB come back three
  seconds after a batch of 25 was collected. Two changes: `collect` removes the id as part of
  the move (after, not before — until the files are elsewhere the entry is true), and
  `forget_everything` clears the whole list and the content folder before every batch, because
  the queue cannot predict which earlier item a new download will share a file with. `collect`
  uses `forget_listed`, which touches only the ACF: clearing the depot cache mid-batch would
  throw away chunks the items still downloading are about to want.
- **The update list is pruned on every rescan.** `apply_update_check` was the only thing that
  ever wrote it and it only runs when somebody presses Check, so a mod Steam updated ten minutes
  later stayed listed as newer on the Workshop indefinitely. What changed's "Update all" now
  takes only what the last check found out of date, which is the other half of the same report:
  it used to queue every changed Workshop mod, and one run sent 32 through SteamCMD when Steam
  had already installed 31.
- Keeping your own copy. *Keep my own copy* on a Workshop mod copies Steam's folder into the
  game's own `Mods/<workshop id>` and writes `About/PublishedFileId.txt`, which is exactly the
  shape a SteamCMD download has — so it is the same mod to everything downstream, Force update
  included. Steam never touches the Mods folder, so nothing overwrites it; and because the copy
  keeps its Workshop id, `check_updates` still tells the user when the author has published
  something newer without any of it arriving on its own. That is why the id is kept rather than
  shed: there is no trade, only a loss, in throwing it away.
  The "lock the launcher on the local version" half is RimWorld's own rule and needs no code:
  with the same packageId in Mods and in the Workshop folder, the game postfixes the *Workshop*
  one with `_steam` and the local copy keeps the plain id ModsConfig.xml names, so the copy is
  what loads. `localize_plan` reads the state, the copy runs off the lock (a big mod is thousands
  of files), then the ordinary two-phase rescan runs and `localized_took_its_place` puts the copy
  in the load order where Steam's was. `fsx::copy_tree` copies through links, so a mod deployed as
  a link to a workspace copies as its files rather than as a link that would dangle.
  `Issue::DuplicatePackageId` had to change with it: two copies of one mod is now something a
  user does on purpose, and "RimWorld picks one copy and ignores the rest" was never true of it.
- `defs`: builds the document the game builds — every active mod's Defs merged in load order,
  every PatchOperation applied in load order, then Name/ParentName inheritance — with the origin
  of every node recorded, so "who wins this value" has an answer. `defs::xpath` is XPath 1.0 as
  .NET's `SelectNodes` means it, because that is what RimWorld hands patches to.
- `clr`: reads .NET assemblies (PE, ECMA-335 metadata, custom attribute blobs, IL) without a
  .NET runtime and without ever loading a mod's code. `harmony` caches those readings and groups
  them into what one mod patches and who else patches the same method.

## Words a player reads

- Everything a player reads is meant to come from `src/lib/locales/en.ts` through `t()` in
  `src/lib/i18n.svelte.ts`. Keys are dotted and say *where* the string is, not what it says: a
  key that is the English text makes a copy edit orphan every translation of it. One entry per
  string somebody reads — a sentence pasted together from fragments cannot be translated, because
  word order is not the same everywhere, so interpolate with `{n}`/`{name}` instead. Counts take
  `{ one, other }`, and `plural()` is the one place that decides, so a language needing CLDR's
  few/many is a change there rather than at two hundred call sites. A missing key returns the
  key: loudly wrong beats quietly blank, because somebody reports `settings.updates.title`.
- A module-level constant must not call `t()`. It would capture whatever locale was current when
  the file first loaded and never change again, so `SORTS` holds keys and `sortLabel`/`sortHint`
  do the lookup. Anything else with a table of text needs the same treatment.
- `tools/i18n-check.mjs` (part of `npm run check`) fails on a user-facing literal in a converted
  component, and carries `PENDING`: the files still holding their own English. **That list only
  ever shrinks.** A file leaves it when converted and is guarded from then on; adding to it is how
  the problem comes back, so a new component is guarded from the day it is written. It also fails
  when a listed file has nothing left in it, since a ledger is only useful while it is true.
  `npm run i18n` prints what is left, file by file — about 386 strings across 21 components at
  the time of writing. `PatchesView` came off the list when it was rebuilt as tabs, which is the
  cheapest moment to convert a file: the markup is being rewritten anyway.
- Not yet done, and each needs its own decision: the prose Rust produces and hands to the UI as
  data (HALO's placement reasons, the log analyzer's findings, `Error::Other` messages) is still
  English inside the payload, so translating it means those becoming keys rather than sentences.
  There is also no second locale and so no picker; adding one is a data file plus the picker.

## The rule databases

- They ship **off**. They are other people's collections of what should load before what, a rule
  from one outranks the mod author's own About.xml, and downloading a few thousand of them on a
  first run and rearranging somebody's list on the strength of them is not a choice to make for
  them. Settings turns each on in a click and says what it is first.
- Switching one off deletes its files (`rules::forget_source`, including every game version's
  copy of a `{version}` source) *and* `Databases::load` refuses to read a disabled source's file.
  Both, on purpose: deleting alone fails when Windows holds a file open or somebody drops one
  back in the folder, and reading the switch alone leaves a database nobody wanted on disk. The
  switch used to do neither — it was written down and nothing read it, so the community rules
  went on ordering mods and the footer went on reporting them as loaded.
- `settings_version` 5 leaves an existing install's switches alone. Anyone already running with
  the community rules has a list built with them; turning them off on the strength of a new
  default would rearrange it overnight. What changes for them is that the switch now works.
- `forget_disabled_databases` also runs at startup, since a build before this one could leave a
  file behind for a source the user had already turned off.

## Loops, and warnings a player disagrees with

- A reported loop is a real path. It used to be the strongly connected component -- the set of
  mods that can all reach one another -- printed in Tarjan's order with arrows between them, so a
  tangle of eight was shown as an eight-step loop naming steps nobody wrote. `order::find_cycle`
  walks the component for an actual cycle; `Issue::Cycle` carries one rule per step and the one
  rule that was `cut`, and the message says where each came from. "The weakest rule was set aside"
  named neither the rule nor its source.
- The cut is one edge per pass, not every edge of the lowest precedence.
- `Issue::Incompatible` can be hidden per pair (`UserData::muted`, keyed by package ids so it
  survives a reinstall). The databases are a community's best guess and a patch can make two mods
  work together without the entry changing; a warning nobody can dismiss is one people learn to
  look past, along with the true ones beside it. Settings brings them all back.

## When something goes wrong

- `diag` writes tracing to `<app data>/logs/circinus.log`, rolled once at 4 MB. Logging to stdout
  is logging to nowhere for a packaged app, which is how a black window got reported with nothing
  to read. `Copy diagnostics` (Settings, and on the crash screen) gathers version, platform,
  folders and whether each is there, what the scan found, and the log's tail, with the home
  directory written as `~` so a bug report does not carry the user's name.
- `Root.svelte` puts the whole window inside one boundary. `Panel` already caught a panel, but
  App's outermost layer sits outside every one, and Svelte re-throws a cached `$derived` failure
  to every later reader -- so one bad value took down the panels *and* the frame.
- `store.accept()` reads the handful of snapshot fields everything depends on the moment one
  arrives. A snapshot that cannot be read used to fail later, inside a derived, and surface as an
  error from inside the framework rather than the one that mattered. With something on screen the
  old copy is kept; with nothing, the message says what happened.
- `?crash=1` in the browser mock returns a snapshot missing `settings`, so all of the above is
  tested rather than assumed (`tools/loadtest/crash.cjs`).

## Packaging

`npm run release` makes the installer players download: `tauri build`, nothing else. Rust and
Node are the whole toolchain. `.github/workflows/release.yml` does it per platform on a tag.

There used to be a .NET sidecar for reading mod assemblies. It is gone: `circinus-core::clr`
reads ECMA-335 in Rust, so the Patches view works in every build with nothing to ship or place.
`tools/harmony-scan` survives only as the test oracle — the C# implementation the Rust reader is
checked against (`crates/circinus-core/tests/clr_reader.rs`). Nothing in the app or the build
runs it. Do not reintroduce a build-time dependency on the .NET SDK.

## House style

Comments explain *why*, in prose, and the code is written to be read. User-facing text is plain
English with no jargon and no exclamation marks: say what happened and what it means. Errors name
the thing that went wrong and what it costs the user. No `unsafe`, no `unwrap` in library paths.
Rust lines are wide (see `rustfmt.toml` if present); run `npm run verify` before calling anything
done. It runs `cargo test`, `cargo clippy`, `npm run check` and the build, plus the loadtests that
need no browser: the list the release runs, and what the Checks workflow runs on every push.

Verify UI work in a real browser rather than by eye: `npm run build`, `npx vite preview`, then a
script under `tools/loadtest/` driving Playwright against `127.0.0.1:4173` with the mock data in
`src/lib/mock.ts`. Assert geometry (column alignment, overlaps, clipping) rather than taking a
screenshot and hoping.

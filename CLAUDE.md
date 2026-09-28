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
  folder holds, and every tooltip says so.
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
- Force update replaces a mod in the folder it is installed in. It used to put every download in
  `Mods/<id>`, and by the `_steam` rule above the game then loads that copy, so a Force update of
  a Steam mod left it stuck at that version: later Steam updates went into a folder the game no
  longer read. A Steam mod is now replaced in Steam's own folder
  (`SteamCmd::replace_workshop_copy`), and a copy Circinus made is replaced in Mods. Steam's
  `appworkshop_294100.acf` is never written, because Steam rewrites it while it runs, so Steam's
  record names the old version until its next check. Nothing is replaced while Steam's staging
  folder for the item exists. Other local folders never get Force update: every build of a
  published mod carries `PublishedFileId.txt`, so the file alone does not mean the folder is a
  SteamCMD download. `scan` requires a real folder named after the Workshop id, which is what
  `collect` and *Keep my own copy* create (`PARSER_VERSION` 6). The update list uses the same rule
  and is pruned on every rescan, because the check only runs when asked and its rows used to stay
  after Steam had already updated the mod.
- SteamCMD keeps its own `appworkshop_294100.acf` and reuses identical chunks it believes are
  already on disk when it builds a download. An item moved to Mods but still listed there is
  harmless until a later item shares a file with it (Vanilla Expanded Framework and Debug
  Assistance ship the same `System.Buffers.dll`). That item's download then reads the file from
  the missing folder and fails with "Missing game files", and SteamCMD validates everything it
  lists and downloads every missing item again. `collect` removes each item from the list as it
  moves it, and `forget_everything` clears the list and the content folder before every batch.
  Before that, installs collected hundreds of megabytes of unrequested copies, the item that hit
  the missing file failed, and other downloads in the batch slowed down.
  `examples/steamcmd_lab.rs` reproduces this against the real SteamCMD, with a control that fails
  the old way and the fixed flow beside it.
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
Rust lines are wide (see `rustfmt.toml` if present); run `cargo test`, `cargo clippy` and
`npx svelte-check` before calling anything done.

Verify UI work in a real browser rather than by eye: `npm run build`, `npx vite preview`, then a
script under `tools/loadtest/` driving Playwright against `127.0.0.1:4173` with the mock data in
`src/lib/mock.ts`. Assert geometry (column alignment, overlaps, clipping) rather than taking a
screenshot and hoping.

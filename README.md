# Circinus Mod Manager

A mod manager for RimWorld with **HALO** — the Harmonized Automated Load Order — groups and filters in the style of Nexus Mod Manager, validation against the community rule databases, and per-mod **Circinus weight** (frame-time share measured by the [Circinus profiler](https://circinus.sh)).

Built with Tauri 2 (Rust) and Svelte 5. MIT licensed, clean-room: it shares file formats and database schemas with RimSort/RimPy so mod lists and rules interoperate, but contains none of their code.

## Installing

Downloads are at <https://circinus.sh>.

**Windows** — run the installer.

**Linux** — mark the AppImage executable (`chmod +x`) and run it.

**macOS** — the first time you open it, macOS says the app *"is damaged and can't be opened"*. It is not damaged. That is what macOS says about any app it cannot check an Apple signature for, and this one is not signed yet — signing and notarising need a paid Apple Developer account. Drag the app to Applications, then run this once:

```sh
xattr -dr com.apple.quarantine "/Applications/Circinus Mod Manager.app"
```

Then open it normally. That command removes the "downloaded from the internet" mark macOS puts on the file; it does not turn off any other protection.

## Layout

```
crates/circinus-core/   Rust library: mod discovery and About.xml parsing, ModsConfig.xml,
                        list importers, rule databases, HALO ordering + validation,
                        texture-collision analysis, Circinus weight client. Fully unit-tested.
src-tauri/              Tauri shell: app state, commands, bundling config, icons.
src/                    Svelte 5 UI (the "Console" design). Runs in a plain browser with
                        example data when Tauri is absent (`npm run dev`).
```

## Develop

Prerequisites: [Rust](https://rustup.rs) (stable), Node 20+, and Tauri's platform prerequisites
(Windows: WebView2 is preinstalled on Windows 10/11 plus the Visual Studio C++ build tools;
macOS: Xcode command line tools).

```sh
npm install
npm run tauri dev        # full app: Rust backend + hot-reloading UI
npm run dev              # UI only, in the browser, with example data
cargo test -p circinus-core
npm run check            # svelte-check
```

`npm run tauri dev` builds a debug binary that loads the UI from Vite's dev server, so it only
runs while that command is running — it is not a standalone exe. Every feature works in it,
including the Patches view: there is nothing to install alongside. For a standalone exe, build a
release:

## Release builds

```sh
npm run release                           # the installer players download
npm run tauri build -- --bundles dmg      # macOS: .dmg (run on a Mac; sign + notarize with an Apple Developer ID)
```

One command, one toolchain: Rust and Node. Everything Circinus does is in the binary — reading
assemblies included — so there is nothing to build alongside it, nothing to place, and nothing a
build can silently lose. `.github/workflows/release.yml` does it for Windows, macOS (Intel and
Apple silicon) and Linux on a tag.

Single self-contained binaries; SteamCMD is downloaded on first use rather than bundled (Valve's terms).

## What works today (milestone 1)

- Finds RimWorld through Steam (`steamlocate`), failing that through the library list in the usual Steam folders (`libraryfolders.vdf`, so a first launch that runs as another account still finds the game and its Workshop folder), failing that a few well-known paths, or a chosen folder; reads `Version.txt`, `Data/`, `Mods/`, and the Workshop content folder in parallel with an mtime-keyed SQLite cache.
- Linked mod folders. A `Mods/` entry that is a symlink or (on Windows) a junction, the way Modmixer, Circinus Dev Tools and hand-made `mklink` links deploy a mod, is read through to the folder it names, as are links inside a mod; RimWorld loads such mods and so must we. The link target is read directly (`circinus-core::fsx`) rather than left to the OS to follow, because opening a link and letting Windows resolve it fails in some setups. The mod keeps the Mods-folder path as its identity (the one RimWorld reports), the details panel says where the files are, and links to nowhere are listed under Settings rather than silently dropped.
- Parses `About.xml` including `*ByVersion` blocks (which replace, not extend, the base lists — RimWorld semantics), `forceLoadAfter/Before`, dependencies with alternatives; Fluffy's `About/Manifest.xml`; `LoadFolders.xml`; `PublishedFileId.txt`; counts assemblies, patches, defs and textures.
- Reads and writes `ModsConfig.xml` (keeps a `.bak`, handles the `_steam` duplicate convention and `knownExpansions`).
- Imports lists from ModsConfig.xml, `.rws` saves (plain, gzip or zstd), `.rml`, RimSort/RimPy JSON and pasted text.
- Loads the community rules and Steam Workshop databases, Use This Instead and No Version Warning, with ETag-cached updates; your own rules live in `dbs/userRules.json` in the shared schema, with an `ignore` block that switches off lower-precedence rules.
- HALO: eight phases (Before the game, Game and DLC, Libraries, Content, Patches, Texture packs, Late loaders, Performance) classified from what each mod contains (a library is a known framework, or code that other active mods depend on *and* that ships few Defs of its own and is not built on a framework — VFE Empire and Dubs Bad Hygiene have add-ons and are content all the same); rules are hard edges in a DAG, contradictions resolved by precedence (yours > the mod's own About.xml > the community databases > what HALO worked out for itself), real cycles explained and cut, priority topological sort that keeps your arrangement where rules allow, pins.
- Dependencies are rules: every `modDependencies` entry becomes a "load after" rule (shown as "needs" in the rules panel and checked like any other rule), and phases are lifted along the hard edges so a mod never sits in an earlier group than something it must load after. A `loadBottom` rule puts a content mod in Late loaders rather than among the performance mods, and its add-ons follow it there, so the performance mods still end the list; "works best at the end" is only raised for mods that no rule forces after a performance mod, and it can be closed.
- Official content, and the rule for silence: RimWorld's `XmlInheritance` resolves a def's `ParentName` only against mods loaded at or before its own, so a mod whose defs inherit from the game loses `BuildingBase`, `MoteBase` and friends above Core, and the game fails in def generation, resets the list and (with a quick-start mod) crashes. Vanilla has no rule about this at all — its depth-first sort will hoist a mod above Core on nobody's say-so — so HALO puts Core and the DLCs in release order and keeps everything that ships Defs below them **when nobody has said otherwise**. When somebody has, they are obeyed: the mod's own About.xml, a database you switched on, your own rule, or filing it under Prepatch by hand all put it above the game, Defs and all. HALO then says what that may cost on the mod's own row rather than moving it back — a mod whose defs inherit nothing from the game loads up there perfectly well, and only its author knows whether they do. Left undeclared, a mod with Defs above official content is still an error.
- Loading time, estimated. Every mod folder is measured for what costs the game time on the loading bar — Defs XML by size, patch operations by count and by how far their XPath searches (a `//` or wildcard query walks the whole unified document and costs many times a direct path), PNG textures without a DDS by pixel count (read from the headers, never decoded), assemblies, sounds — and `circinus-core::loadcost` folds that into a score. The **Load** column shows each active mod's share of the list's estimate with a band; hover for the breakdown; the Inspector has a section; the Show menu narrows to the slow loaders. A ranking, not a stopwatch: the coefficients live in one place so measured figures can replace them.
- The HALO page (sidebar) explains the ordering and lets you change it, with a warning that it is for advanced users. A mapping board shows every signal HALO looks at, in the order it tries them, wired to the phase it files a mod under; each signal can be switched off or sent to another phase, and your own mappings — a package id to a phase, a name fragment to a phase — sit above the built-in ones. The game's own content cannot be moved. Everything is one Reset away, and the edits live in the user data as package ids and names, so they survive a reinstall.
- Load order view. By default the list is the plain load order, exactly as ModsConfig.xml has it top to bottom, with a Phase column saying where HALO files each mod; **By phase** gathers the same rows under phase headers (the toolbar toggle, remembered in settings). A column header names every column: #, Mod, Package id, Cost, Load, Versions, Phase, Group, then one fixed slot each for Changed, Update, Errors, Warnings, Notes and Pinned, so badges never draw over one another; a slot with more than one item shows a count and lists them all on hover. Mod and Package id can be dragged to any width from their header edge (double-click puts the default back), the widths are remembered, the package id column steps aside on narrow windows rather than squeeze the names, and the Move column appears only while a HALO preview is up. The toolbar never wraps: labels give way to icons first. Drag rows (or a multi-selection) to reorder, with edge scrolling; the Show menu narrows the list to mods with errors, warnings, conflicts, HALO notes, changes since the last launch, or moves HALO would make, and by source and game version. The banner's Review button (or F8) walks the mods with something to look at, one press each, most serious first, switching tab and lifting filters as needed.
- Groups fill themselves when you let them: Core takes the game and its DLC, Frameworks whatever HALO files as a library, Performance the performance mods, and any group can be set to take the game and DLC, a HALO phase, or an author's mods (the gear → *Fills itself with*). A mod put in a group by hand stays there; the rule only fills what is unassigned, and it never feeds back into the order. Groups are yours to make: name, colour, and where members sort. A group can sort its members as one of the eight phases, or have **its own section** in the load order, placed right after the phase you choose (several such groups after one phase follow one another in the order you keep them). The section shows up as its own header in the list and as a choice under a mod's "Sort it as"; picking it there puts the mod in that group. Rules between mods still hold inside and across sections, and a mod's own "Sort it as" beats its group.
- Right-click a mod (or a selection) for the menu: activate or deactivate, move to top or bottom, keep its position, Sort it as and Group as submenus (with New group), open folder, Workshop page, copy name, packageId, Workshop id, link or folder path, Force update (downloads the current version through SteamCMD into the folder the mod is installed in: Steam's own folder for a Steam mod, `Mods/<workshop id>` for a copy Circinus made; other local folders don't get this option), Unsubscribe (opens the mod's page in the Steam client, since only Steam can unsubscribe), and Delete for local folders (recycle bin; a link in the Mods folder is removed on its own and its target left alone).
- Several lists. The RimWorld card's list switcher saves the active list under a name (`<data>/lists/named/<name>.xml`, plain ModsConfig form), switches between named lists, renames and deletes them. While a named list is the current one, Save writes both it and ModsConfig.xml; Leave it to work on ModsConfig.xml alone. Previous versions of every list Circinus read or wrote stay in the history under Import.
- Steam collections. Follow a collection by its link from the Collections card: it shows how much of it is installed and active; opening it lists every item with Show, Activate or Download, and the buttons queue all missing items for SteamCMD, activate the installed ones in the collection's order, or make a named list of them. Check for changes fetches it again and shows what the curator added or removed since you last looked, until you press Got it.
- The four tiles above the list say more on hover (the rules not met, the errors, which mods win the most texture files, how heavy the list is) and narrow the list on click: rule problems, errors, mods replacing the same textures, or heavy mods; with nothing to narrow they open the Analyzer, Textures or Settings.
- Validation: anything with Defs above Core or a DLC (an error — the game will reset the list), missing dependencies, incompatibilities, order violations, version mismatches, duplicates, misplaced optimization mods, and texture collisions (which mod wins each file).
- Circinus weight column and tile, fed by the public circinus.sh API and your local `Circinus/Runs`.

## Milestone 2 (downloads)

- Virtualized mod list: only visible rows exist in the DOM, so 1,000+ active mods render instantly.
- SteamCMD is installed on first use into Circinus's data folder (never bundled). Downloads run as batched runscripts with an anonymous login and land in `Mods/<workshop id>` with a `PublishedFileId.txt`. A Force update of a Steam mod is the exception: it replaces Steam's copy in Steam's own folder (never while Steam is downloading that mod itself), and Steam's record of the item is left for Steam to bring up to date.
- Smart throttle: batches start at 25 and halve when Steam refuses (login refused, half the batch failing, or a stall), with an exponential cooldown (30 s → 10 min) that decays after clean batches; stalls are killed after 150 s of silence; each item gets four tries, with `validate` after the first failure; the queue is persisted and resumes after a restart. Each item is removed from SteamCMD's workshop ACF when it is moved into Mods, and before every batch the ACF, the depot cache and SteamCMD's content folder are cleared, so re-downloads really download. This also stops SteamCMD downloading moved items again by itself: if a moved item is still listed and a later download shares a file with it, that download fails and SteamCMD re-downloads every listed item whose folder is missing.
- `examples/steamcmd_lab.rs` in `circinus-core` runs the real SteamCMD in a scratch folder, with `HOME` set inside it (it refuses to start otherwise). It runs a control that reproduces the re-download above with the old `collect`, the fixed flow, and a Force update into a copy of Steam's library; its header explains how to run it. The unit tests only stage SteamCMD's folders by hand, so they can't test SteamCMD's own behaviour.
- Steam Web API (no key): names for queued items, collection expansion (one level of sub-collections), and Workshop update checks against on-disk timestamps. Only Steam mods and copies Circinus made are checked; other local folders with a `PublishedFileId.txt`, such as dev builds, are never offered updates. A mod drops off the list at the next rescan once it is up to date.
- Import dialog accepts Steam collection links and Rentry links; missing items can be queued in one click, as can everything in ModsConfig.xml that is not installed.
- `tools/loadtest` renders the UI at ~2,000 mods in headless Chromium; `cargo run -p circinus --example dump_snapshot` produces a real backend snapshot for it.

## Milestone 3a (change detection, SteamCMD everywhere)

- After every scan Circinus stores a fingerprint of each installed mod (name, packageId, version, Workshop id, source, newest mtime, and Steam's `timeupdated` from `appworkshop_294100.acf`). On the next launch the fresh scan is diffed against it: mods that were added, removed or updated are listed under one heading each — updated on the Workshop, new version on disk, files changed, renamed or moved, new, removed — with the date; edits to `ModsConfig.xml` made outside Circinus (RimWorld's own mod menu, another manager) are reported as what was added to the list, taken off it, and moved (the fewest moves that explain the new order, with old and new positions). The banner, the title bar and the row flags all point at the "What changed" list; **Got it** re-baselines.
- Steam can replace files deep inside a Workshop item without touching the folder's mtime, so `timeupdated` is part of the cache stamp and of `modified` for Workshop items. That also makes the Workshop update check exact.
- While Circinus is open a watcher polls four mtimes every 8 s (the ACF, ModsConfig.xml, Mods/, the Workshop folder); a change triggers a cached re-read (about 150 ms for 2,000 mods), a toast, and a desktop notification via `tauri-plugin-notification` — so an update Steam applies while the game is starting is not missed.
- SteamCMD is now visible from everywhere: a status chip in the title bar (not set up / ready / downloading / cooling down / failed), a **set up** hint in the sidebar, a Settings section with paths, **Test SteamCMD** (`+login anonymous +quit`, output in the log — on Windows this also proves the console-log tail works) and **Reinstall**, a first-run banner when the list has mods that are not installed, and **Force update** on every Steam mod and every copy Circinus made, in the Inspector and in the change list.

## Subscribing through the Steam client

SteamCMD downloads a Workshop item anonymously into `Mods/<workshop id>`; nothing keeps it
updated and Steam never learns about it. Subscribing is the other half: the item goes to your
subscriptions, Steam keeps it current, and it lands in the Workshop folder with everything else.

**Circinus subscribes by opening the item's page in the Steam client** (`steam://url/CommunityFilePage/<id>`,
the web page when no Steam installation is found) and says so plainly: *Steam has been asked;
press Subscribe on each page.* It does not claim the mod is subscribed, because pressing the
button is yours to do. What it does afterwards is watch Steam's own record —
`appworkshop_294100.acf` — for a few minutes and report the moment the item really arrives (or
really goes), then rescan. The other route, `ISteamUGC::SubscribeItem` through a helper binary
linked against Valve's `steam_api64.dll`/`.so`, would subscribe with no press at all, but it needs
that redistributable shipped with Circinus (Valve's SDK licence, not MIT, which is a decision the
project has not taken), the client running and logged in as the account that owns RimWorld, and it
fails in several silent ways that each have to be told apart and explained. Opening a page works
everywhere, needs nothing installed, and never pretends. `steam://subscribe/…` handling exists in
some client builds and is silently ignored in others, so it is not used.

- Banner, when mods in your list are not installed: **Subscribe in Steam** beside **Download with
  SteamCMD** — Steam keeps them updated; SteamCMD needs no client.
- Right-click menu and Inspector: **Unsubscribe**, behind a confirmation that says Steam deletes
  the mod's folder. Only items Steam actually lists are offered; a SteamCMD or hand-copied copy is
  named as such instead, because Steam has nothing to remove.
- A missing dependency that names its Workshop page gets its own **Subscribe in Steam**.
- Commands: `steam_client_status()`, `subscription_state(ids)`, `subscribe_items(ids)`,
  `unsubscribe_items(ids)`, `missing_workshop_ids()`. Steam gets eight pages at a time; the rest
  are reported as not opened rather than silently dropped. Logic and its tests live in
  `circinus-core::steam::client`.

## Launching the game

Play starts RimWorld through Steam (`steam://rungameid/294100`) when the game folder is inside a Steam library, and otherwise runs the executable Circinus detects (`RimWorldWin64.exe`, `RimWorldMac.app`, `RimWorldLinux`). Settings → Launching RimWorld lets you force either method, pick the executable by hand (GOG, DRM-free, a copy outside Steam), add arguments such as `-popupwindow`, and choose whether unsaved changes to ModsConfig.xml are written first (default on). Non-standard folders — game, config, local mods, Workshop — are set in Settings → Where RimWorld lives.

## Milestone 3c (after a crash)

- **List history.** Every real list Circinus reads or writes is archived under `<data>/lists/` (`<unix>-saved|seen|before-reset.xml`, newest forty kept, deduplicated). When RimWorld's "Resetting mods config and trying again" leaves only official content behind, Circinus notices on the next read, archives the list the session started with, and offers *Restore and save*; Import → Previous lists browses the archive.
- **Game log analyzer** (Analyzer → Last game run). Reads `Player.log` (or `Player-prev.log`, or any file) and says what happened: loaded / load failed and reset / crashed; the exception that broke loading with its innermost mod frame and Harmony patch owners; the native crash with its first mod frame and whether it ran off the main thread during a quick-start; XML errors and missing parents grouped by mod; exception groups (Unity's `[Ref]`/"Duplicate stacktrace" folding respected); DDS files Unity refused; textures not found; duplicates; timings; environment. Each finding is tied to an installed mod by `[Source:]` name, Workshop id or folder in a path, Harmony id, or the assembly a frame's namespace lives in, and a mod sitting above Core is called out as the reason for missing Core parents. Parser in `circinus-core::playerlog` (`cargo run -p circinus-core --example playerlog -- Player.log`).
- **DDS audit** (Textures → DDS files the game will refuse). Reads the header of every `.dds` Circinus did not write and flags what Unity 2022 cannot create a texture from: block-compressed files with a side that is not a multiple of four, truncated files, unreadable headers. *Fix* rebuilds a file through the same encoder and validator — from the PNG beside it, or from the file's own BC1/BC3/BC7 top level — and keeps the original as `.dds.circinus-orig`; the manifest records the replacement, so a mod update hands the file back to its author and *Revert* restores the original instead of just deleting.

## Milestone 4a (texture optimisation)

- Native DDS pipeline in `circinus-core::dds`, no external tool: PNG → BC1 (opaque) or BC7/BC3 (alpha) with a full mip chain to 1×1, dimensions rounded up to multiples of four by resizing (never padding), colour bled into transparent texels at every level so neither the mips nor the GPU's bilinear filter pick up dark fringes, and every texture flipped vertically before encoding, because Unity reads a DDS bottom-up and one written the natural way arrives in the game upside down. Encoding is Intel's ISPC texture compressor (`intel_tex_2`, MIT/Apache, prebuilt kernels for x86_64 and aarch64 on Windows, macOS and Linux); the two quality settings are its very-fast and fast BC7 modes. Quality is BC7 effort and nothing else: an opaque texture is BC1, which has one mode, so it is byte-identical either way, and a BC7 block is a fixed 16 bytes, so the setting never changes a file's size — only how closely the colours match.
- Every file is validated before it is put in place: header, flags, mip count, exact length, then the top level is decoded (`bcdec_rs`) and compared with the source — PSNR in premultiplied space and alpha coverage. Failures leave the PNG alone. Writes are temp-file-then-rename.
- A manifest in the cache (`dds_files`) records every file Circinus wrote: source size/mtime/xxh3, DDS size/hash, format, dimensions. Re-runs skip unchanged sources; a DDS an author ships is never touched; **Revert** deletes only files whose hash still matches what Circinus wrote, and runs as a background job like a conversion — every file is read to check it is ours, so removing a whole library takes a while and shows progress, can be stopped, and ends with a toast. When the change detector sees a mod update, its converted files are re-checked and stale DDS removed before the game can load old art; with the auto option, changed and new mods are converted again.
- Textures view: totals (files, disk, VRAM saving), Optimise active / everything / Remove all, live progress with rate and ETA, per-mod table with exclude/optimise/revert; Inspector shows per-mod counts with the same actions. Official content (Data/) is left as shipped.
- `cargo run -p circinus-core --example dds_convert -- in.png` converts one file; `cargo run -p circinus --example dds_job -- <game> <data> convert|revalidate|revert <mod folder>…` runs the job headless; `cargo run -p circinus --example halo_check -- <game> <data>` sorts an install and checks the official-content invariant on the result.

## Milestone 3b (what the game really ends up with)

- **Def flattening** in `circinus-core::defs`. Circinus builds the document the game builds: every active mod's `Defs/` into one arena in load order, every mod's `PatchOperation`s over it in load order, then `Name`/`ParentName` inheritance — RimWorld's order, so the answer is the game's answer. `tree` is a mutable arena holding the parts of .NET's `XmlDocument` a patch can observe, with the origin that created it on every node. `xpath` is XPath 1.0 as .NET's `SelectNodes` means it (all thirteen axes, positional predicates that count the way reverse axes require, the core function library, the conversion rules), because a patch means whatever that language says it means; `Defs/Type[defName="X"]` — nearly every patch ever written — is answered from an index rather than a scan. `flatten` writes down what happened: every value one mod took from another with both values and the operation that did it, patches whose xpath matches nothing, patch files the game silently ignores, duplicate defs, defs whose `ParentName` names nothing, and per-mod wins and losses. `MayRequire` nodes for absent mods are dropped; `Sequence`, `Conditional`, `FindMod` and `Test` behave as the game's do; an operation from another mod's patch framework is named rather than skipped in silence.
- **Harmony patch targets**, read from the assemblies themselves. `circinus-core::clr` reads ECMA-335 — the PE and .NET metadata format — directly in Rust: no .NET runtime, no companion binary, and it never loads or runs a mod's code. It reports `[HarmonyPatch]` targets in all their shapes, Harmony ids and manual `Patch` calls from IL, `[StaticConstructorOnStartup]` and `Verse.Mod` classes, and the `AccessTools` lookups that frameworks like Vehicle Framework patch through (which a reader of attributes alone misses entirely — 266 real targets in `Vehicles.dll` against zero). `circinus-core::harmony` caches a reading per assembly and groups the results two ways: what one mod patches, and who else patches the same method. Two mods prefixing or transpiling one method is *contested* — the usual shape of "these two don't work together"; two postfixes stack and are not. `tools/harmony-scan`, the C# tool this replaced, stays as the test oracle: `crates/circinus-core/tests/clr_reader.rs` asserts the Rust reader agrees with it field for field on Harmony's own 2.4 MB assembly.
- **Where the Patches view is, and what it needs.** *Patches* is in the left sidebar, under the list. It needs nothing: the reader is `circinus-core::clr`, compiled into the binary, so the view works in a release build and in `npm run tauri dev` alike, with no .NET SDK, no companion executable to find and nothing a build can leave out. It used to need a .NET sidecar beside the executable, and a view that reported the scanner missing was the usual way an incomplete install announced itself; that whole failure is gone rather than handled.

## Milestone 4b (instances, and Steam)

- **Instances.** A named set of game, config, local-mod and Workshop folders with its own launch settings: "1.6 vanilla-ish", "CE playthrough", "modding sandbox". The switcher lives in the title bar; the dialog creates, duplicates, renames and deletes them. Deleting one forgets the instance and nothing else — the mods and the saves stay where they are. Each instance keeps its own named lists, its own current list and its own change baseline (a shared baseline would report the other install's mods as added and removed on every switch); the mod cache and the DDS manifest stay keyed by folder path, since two instances sharing a Workshop folder share those files. A separate config folder reaches the game as `-savedatafolder`, so switching cannot quietly write the wrong ModsConfig.xml. An install made before instances existed becomes the Default instance, settings and lists intact.
- **Subscribing through the Steam client** — see the section above. `steam://` links only, deliberately.

## Next milestones

Auto-update, once **https://circinus.sh/modmanager** is serving builds (a separate effort). The app side is `tauri-plugin-updater` pointed at that feed, a check-on-start setting, a *Check now* button, and an install-and-restart banner.

## Two lists side by side

**Inactive | Active** (in the toolbar) puts the mods you have beside the mods you use, and you drag between them: into the active pane at the position you drop, out of it to switch a mod off. On a window too narrow for two readable lists it falls back to one pane and says why.

## What HALO would change

**What changes** appears once a preview exists. It does not put two lists side by side, because on a real list that hides the answer: lift one mod from #900 to #12 and 888 others have a new number without HALO having decided anything about them. So the two orders are compared the way a diff compares two files. The longest run of mods that keep their order relative to one another is the backbone; everything else is a mod HALO actually lifted out of its place. A thousand-mod list with a thousand new numbers usually holds a few dozen such moves, and those are what the view is about.

The columns then stop being the two orders and become **what leaves** and **what arrives**: on the left a card per phase mods are leaving, on the right a card per phase they land in, and between them one arrow per journey, weighted by how many mods make it and carrying the count. That is the shape of the change in one look — three loaders pulled to the top, four libraries up behind them, three performance mods pushed to the end — which no row-by-row view says out loud. Each card lists its mods with the number they have and the number they would have, ten at a time with the rest a click away, and each row's tooltip is HALO's own reason for filing it there. Hovering an arrow or a phase dims everything not making that journey; clicking one keeps only those moves; the search box narrows the cards with everything else; clicking a mod selects it, so the panel can explain it. The sentence above says how many mods move and how many only change number, which is the question the old two-list view could not answer.

## Making a release

**Actions → Release → Run workflow**, type the version and what changed, press the button. Nothing runs on your own machine: GitHub sets the version in the three files that carry it, commits, tags, builds the Windows installer, the Mac disk image and update bundle and the Linux AppImage on three machines, and uploads all four to circinus.sh. A Windows installer can only be built on Windows, so no single machine can make the set.

Leaving the version box **empty** builds all three and publishes nothing. That is the rehearsal, and it is the cheapest way to find out that a platform stopped building.

The release commit belongs to the tag rather than to `main`: the tag is the record that a version happened, and pushing a tag carries the commit with it. `main` keeps the version it had, because the version is chosen when a release is cut.

From a terminal instead, if you want the tests to run here first:

```sh
node tools/setup-release.mjs    # once per checkout: the workflow, the leftovers, the secrets
node tools/release.mjs 0.2.0    # cuts it, then follows the run
```

`--checks-in-ci` skips the local tests and lets the three build jobs be the judge; `--local` builds and pushes only the platform you are on, for a one-platform fix; `--dry-run` says what would happen. `docs/update-feed.md` has the whole of it, including what the site refuses and why.

## Getting help

The sidebar ends with **Help on Discord**, and Settings has a *Help and about* card with the same link beside circinus.sh: <https://discord.gg/JvsdeBw897>. A mod sorted somewhere odd is worth reporting there with the mod's name and where you expected it instead.

## The list's columns

The list opens **By phase** with the columns most people read: name, package id, Load and Versions (Cost joins them once weights are loaded). Phase and Group are off by default — under *By phase* the sections already say the phase — and Show → Columns turns any of them on or off. The header is one grid with the rows, so a column label always sits over its own column, and the six badge slots (changed, update, errors, warnings, notes, pinned) keep one fixed slot each.

## Dependencies

A dependency is matched the way RimWorld matches it: the `_steam` postfix a copy from the Workshop carries is not part of a mod's identity, `alternativePackageIds` count, and a dependency that names a Workshop item (`steamWorkshopUrl`) is met by that item whatever its About.xml calls itself — so Harmony, which every C# mod names now that nothing bundles it, is recognised in all the shapes it is installed in. A mod that is present but unreadable is reported as present, not as missing, and while the scan has not seen the whole install — no mods yet, or a Workshop folder that produced nothing — Circinus says nothing about missing dependencies rather than calling everything uninstalled.

## The window

On the first launch the window takes most of the screen's work area (between 1180 and 1880 logical pixels wide), centred; after that it opens where it was closed, size and position and maximised state, as long as that spot is still on a monitor.

## Data locations

- Settings, cache and databases: `%LOCALAPPDATA%\Circinus` (Windows) or `~/Library/Application Support/Circinus` (macOS).
- Your rules: `<data>/dbs/userRules.json`.

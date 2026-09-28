// Mirrors crates/circinus-core/src/model.rs and src-tauri/src/state.rs (camelCase over the wire).

export type Source = "ludeon" | "workshop" | "local" | "steamcmd" | "git";
export type ModKind = "unknown" | "official" | "code" | "xml" | "textures" | "translation" | "scenario";
export type Phase = "core" | "prepatch" | "framework" | "content" | "patch" | "texture" | "late" | "optimization";
export type RuleSource = "halo" | "community" | "about" | "user";
export type RuleKind = "loadAfter" | "loadBefore" | "incompatible" | "loadTop" | "loadBottom";
export type Severity = "error" | "warning" | "note";
export type Band = "negligible" | "light" | "moderate" | "heavy" | "veryheavy" | "insufficient" | "unknown";

export interface Dependency {
  packageId: string;
  displayName?: string;
  workshopUrl?: string;
  downloadUrl?: string;
  alternatives?: string[];
}

export interface AboutRules {
  loadAfter: string[];
  loadBefore: string[];
  forceLoadAfter: string[];
  forceLoadBefore: string[];
  incompatibleWith: string[];
  dependencies: Dependency[];
}

export interface Contents {
  assemblies: number;
  patches: number;
  defs: number;
  textures: number;
  dds: number;
  sounds: number;
  languages: number;
  bundlesHarmony: boolean;
  sizeBytes: number;
  /** What loading the mod costs the game, from the folder alone. */
  load?: LoadCost;
}

/** The parts of a folder that cost loading time (facts) and the estimate made from them (a model). */
export interface LoadCost {
  defBytes: number;
  patchBytes: number;
  patchOps: number;
  /** Operations whose XPath searches the whole document. */
  heavyOps: number;
  /** Pixels of PNG/JPG the game will decode: textures with no DDS beside them. */
  pngPixels: number;
  pngBytes: number;
  ddsBytes: number;
  dllBytes: number;
  soundBytes: number;
  /** Estimated milliseconds on a typical machine; only the ranking means much. */
  scoreMs: number;
}

export interface ModInfo {
  uid: string;
  /** The entry in the mod folder, the path RimWorld reports for the mod. */
  path: string;
  /** Where the files really are when `path` is a link to a folder kept elsewhere. */
  linkTarget?: string;
  packageId: string;
  name: string;
  authors: string[];
  description: string;
  supportedVersions: string[];
  modVersion?: string;
  url?: string;
  steamAppId?: number;
  publishedFileId?: number;
  source: Source;
  preview?: string;
  rules: AboutRules;
  manifest?: unknown;
  loadFolders?: unknown;
  contents: Contents;
  /** Newest mtime under the folder; for a Workshop item, the newer of that and Steam's
   *  timeupdated, because Steam can change files without touching the folder. */
  modified: number;
  /** When Steam says the author last published an update; 0 for anything Steam has not updated. */
  updated: number;
  invalid?: string;
  kind: ModKind;
}

export interface Rule {
  kind: RuleKind;
  subject: string;
  target?: string;
  source: RuleSource;
  comment?: string;
}

export type Issue =
  | { kind: "missingDependency"; uid: string; dependency: string; displayName?: string; installedUid?: string; workshopUrl?: string }
  | { kind: "incompatible"; uid: string; otherUid: string; source: RuleSource }
  | { kind: "orderViolation"; uid: string; targetUid: string; rule: RuleKind; source: RuleSource; comment?: string }
  | { kind: "versionMismatch"; uid: string; supported: string[] }
  | { kind: "cycle"; uids: string[]; chain: string; rules: Rule[]; cut?: Rule }
  | { kind: "textureCollision"; path: string; uids: string[]; winnerUid: string }
  | { kind: "misplacedOptimization"; uid: string; afterUids: string[] }
  | { kind: "duplicatePackageId"; packageId: string; uids: string[] }
  | { kind: "missingPackageId"; uid: string }
  | { kind: "invalid"; uid: string; reason: string }
  | { kind: "aboveOfficial"; uid: string; officialUid: string; declared: boolean }
  | { kind: "ruleIgnored"; uid: string; targetUid: string; rule: RuleKind; source: RuleSource; reason: string };

export interface Placement {
  uid: string;
  phase: Phase;
  reason: string;
  /** The user's group it sorts with when that group has its own section after `phase`. */
  section?: string;
}

export interface SortResult {
  order: string[];
  placements: Placement[];
  moves: [string, number, number][];
  issues: Issue[];
}

export interface Locations {
  gameDir?: string | null;
  configDir?: string | null;
  localModsDir?: string | null;
  workshopDir?: string | null;
}

export interface GameVersion {
  full: string;
  majorMinor: string;
}

export interface DbSource {
  id: string;
  label: string;
  url: string;
  file: string;
  enabled: boolean;
}

export type DdsFormat = "bc1" | "bc3" | "bc7";
export type DdsQuality = "quick" | "balanced";

export interface DdsSettings {
  /** Format for textures with alpha; opaque ones are always BC1. */
  alphaFormat: DdsFormat;
  quality: DdsQuality;
  mipmaps: boolean;
  /** 0 = all cores but one. */
  threads: number;
  /** Convert new and updated mods on their own. */
  auto: boolean;
}

export type LaunchMethod = "auto" | "steam" | "executable";

export interface LaunchSettings {
  method: LaunchMethod;
  /** Explicit executable; null = detect from the game folder. */
  executable: string | null;
  /** Extra command-line arguments, e.g. `-popupwindow`. */
  args: string;
  /** Write ModsConfig.xml first when there are unsaved changes. */
  saveFirst: boolean;
}

export interface LaunchInfo {
  executable: string | null;
  executableExists: boolean;
  steamInstall: boolean;
  autoResolvesTo: "steam" | "executable";
  /** The whole command line Play uses, `-savedatafolder` included. */
  args: string[];
  /** Where the game will keep its config and saves, when that is not the usual folder. */
  saveDataFolder: string | null;
}

/** A named set of folders with its own launch settings and its own named lists. */
export interface Instance {
  id: string;
  name: string;
  locations: Locations;
  launch: LaunchSettings;
  createdAt: number;
}

export interface Settings {
  locations: Locations;
  dbSources: DbSource[];
  showWeight: boolean;
  includeLocalRuns: boolean;
  alphabeticalWithinPhase: boolean;
  updateDatabasesOnStart: boolean;
  /** Show the active list in HALO's phase sections rather than as the plain load order. */
  listByPhase: boolean;
  /** Show the HALO page's advanced controls. */
  haloAdvanced: boolean;
  /** Column widths dragged in the list, CSS px, by column key (`name`, `pkg`). */
  columns?: Record<string, number>;
  /** Optional list columns that are shown: `load`, `versions`, `phase`, `group`. */
  listColumns?: string[];
  /** Bumped when a default changes, so stored settings can be brought along. */
  settingsVersion?: number;
  dds: DdsSettings;
  launch: LaunchSettings;
  /** Ask circinus.sh for a newer build a few seconds after launch (nothing installs on its own). */
  checkForUpdates?: boolean;
}

/** What asking circinus.sh for a newer build found. */
export interface UpdateCheck {
  available: boolean;
  /** The version this build is. */
  current: string;
  /** The newest version on offer, when it is newer than this one. */
  version?: string | null;
  notes?: string | null;
  /** RFC 3339, as the feed sent it. */
  pubDate?: string | null;
}

/** One `update-progress` event while an update installs. */
export interface UpdateProgress {
  phase: "downloading" | "installing" | "restarting" | "failed";
  version: string;
  downloaded: number;
  /** The download's size, when the server said. */
  total: number | null;
  error?: string | null;
}

/** How a group finds members on its own: the game and DLC, a HALO phase, or an author. */
export type AutoRule = { kind: "official" } | { kind: "phase"; phase: Phase } | { kind: "author"; name: string };

export interface Group {
  id: string;
  name: string;
  color: string;
  /** Members are sorted as this phase; with `section`, the phase the group's own section follows. */
  phase?: Phase | null;
  /** The group has its own place in the load order: a section right after `phase`. */
  section?: boolean;
  /** Members the group picks up by itself, on top of those assigned by hand. */
  auto?: AutoRule | null;
}

/** Colours a group can have; `c-<name>` classes exist for each. */
export const GROUP_COLORS = ["blue", "teal", "green", "pink", "amber", "coral", "violet", "slate"] as const;

export interface UserData {
  groups: Group[];
  modGroups: Record<string, string>;
  pinned: string[];
  phaseOverrides: Record<string, Phase>;
  notes: Record<string, string>;
  muted: string[];
  /** Mods whose textures must not be converted. */
  ddsExcluded: string[];
  /** Steam collections the user follows. */
  collections?: TrackedCollection[];
  /** The default groups were given their automatic members once. */
  autoGroupsAdopted?: boolean;
  /** Edits to HALO's classification made on the HALO page. */
  halo?: HaloRules;
  /** Collection id → the timestamp of the newest announcement read from that pack. */
  packsRead?: Record<string, number>;
  /** Collections whose curator the user would rather not hear from. Still followed. */
  packsMuted?: number[];
}

/** The user's own HALO rules: portable statements about mods, not folders. */
export interface HaloRules {
  /** packageId (lowercase) → phase. A per-mod Sort it as still wins. */
  packagePhases: Record<string, Phase>;
  /** Name contains (case-insensitive) → phase, first match wins. */
  namePhases: NamePhase[];
  /** Built-in rules switched off, by key. */
  off: string[];
  /** Built-in rules sent to another phase, by key. */
  retarget: Record<string, Phase>;
}

export interface NamePhase {
  needle: string;
  phase: Phase;
}

/** One of HALO's built-in classification rules, in the order they are tried. */
export interface BuiltinRule {
  key: string;
  signal: string;
  detail: string;
  phase: Phase;
  ids: string[];
  editable: boolean;
}

export const EMPTY_HALO: HaloRules = { packagePhases: {}, namePhases: [], off: [], retarget: {} };

export interface Weight {
  packageId: string;
  share: number | null;
  band: Band;
  ranked: boolean;
  seen: number | null;
  measured: number | null;
  rankedRuns: number | null;
  installs: number | null;
  netLow: number | null;
  netHigh: number | null;
  withheld: boolean;
  origin: "api" | "local";
}

export interface Snapshot {
  locations: Locations;
  gameVersion: GameVersion;
  mods: ModInfo[];
  active: string[];
  missing: string[];
  issues: Issue[];
  placements: Placement[];
  rules: Rule[];
  user: UserData;
  settings: Settings;
  weights: Record<string, Weight>;
  weightsFetchedAt: number;
  /** One raw record as circinus.sh sent it, pretty printed. */
  weightsSample?: string;
  dirty: boolean;
  dbLoaded: string[];
  scannedAt: number;
  /** Mods whose folders are still being inspected in the background. */
  inspecting: number;
  /** Entries in a mod folder the scan had to leave out, with the reason. */
  unreadable?: { path: string; reason: string }[];
  /** Texture collisions left out of `issues` to keep the payload small. */
  issuesTruncated: number;
  /** Installed workshop mods with a newer version on the Workshop (from the last check). */
  updates: UpdateInfo[];
  updatesCheckedAt: number;
  /** Mods that appeared, disappeared or changed since the previous session (or the last acknowledgement). */
  changes: ModChange[];
  /** Edits to ModsConfig.xml made outside Circinus since then. */
  listChange: ListChange | null;
  /** Unix seconds of the baseline the changes are measured from (0 = first run). */
  changesSince: number;
  /** uid → unix seconds Circinus first saw that folder, for the ones that arrived while it was
   *  watching. A mod already installed the first time we looked is absent. */
  firstSeen: Record<string, number>;
  /** The mods still worth marking new, most recent first. */
  newUids: string[];
  /** uid → what Circinus has converted for it. */
  dds: Record<string, DdsSummary>;
  /** RimWorld failed to load and wrote a Core-only list; what to put back. */
  listReset: ListReset | null;
  /** The named list being worked on, if any. Save writes it too. */
  currentList?: string;
  /** The user's named lists, newest first. */
  namedLists?: NamedList[];
  /** The instance these folders and lists belong to. */
  instance?: Instance;
  /** What the curators of followed packs have said, newest first. Muted packs are absent. */
  announcements?: Announcement[];
  /** Unix seconds of the last successful fetch (0 = never asked). */
  announcementsCheckedAt?: number;
}

export interface SavedList {
  path: string;
  savedAt: number;
  /** "saved" (written by Circinus), "seen" (found on disk), "before-reset" (rescued from memory). */
  label: string;
  count: number;
  gameVersion: string;
}

/** A list kept by name, in ModsConfig.xml form, under the data folder. */
export interface NamedList {
  name: string;
  path: string;
  count: number;
  updatedAt: number;
  gameVersion: string;
}

/** A Steam collection the user follows. `items` is what it holds now, `known` what it held when last reviewed. */
export interface TrackedCollection {
  id: number;
  name: string;
  creator: string;
  items: number[];
  known: number[];
  names: Record<string, string>;
  checkedAt: number;
  addedAt: number;
  timeUpdated: number;
}

/** Something a modpack's curator said, fetched from circinus.sh for a followed collection.
 *
 *  `author` is the curator, and the UI must say so: this is somebody else's text shown inside
 *  Circinus, and a player deciding whether to act on it needs to know whose words they are. */
export interface Announcement {
  id: string;
  /** The Workshop collection id. */
  pack: number;
  /** Unix seconds. */
  at: number;
  author: string;
  text: string;
  link?: string | null;
}

export interface ListReset {
  previousCount: number;
  restoreFrom: SavedList | null;
}

export interface RestoreResult {
  snapshot: Snapshot;
  restored: number;
  missing: string[];
}

export interface DdsSummary {
  count: number;
  ddsBytes: number;
  pngBytes: number;
  /** Bytes the GPU would hold for these textures uncompressed (RGBA8 with mips). */
  vramBefore: number;
  newest: number;
}

// ---- textures ----
export interface DdsProgress {
  total: number;
  done: number;
  converted: number;
  failed: number;
  pngBytes: number;
  ddsBytes: number;
  current: string;
}

export interface DdsReport {
  /** What the job was: convert | revert | fix | audit. */
  kind?: string;
  mods: number;
  converted: number;
  failed: number;
  current: number;
  shipped: number;
  pngBytes: number;
  ddsBytes: number;
  seconds: number;
  cancelled: boolean;
  reverted: number;
  restored?: number;
  bytesFreed: number;
  fixed?: number;
}

export type DdsProblem = { kind: "notMultipleOf4" } | { kind: "truncated"; expected: number; actual: number } | { kind: "unreadable"; reason: string };

export interface DdsFinding {
  rel: string;
  width: number;
  height: number;
  format: string;
  levels: number;
  bytes: number;
  problem: DdsProblem;
  hasPng: boolean;
  fixable: boolean;
}

export interface ModAudit {
  uid: string;
  name: string;
  active: boolean;
  findings: DdsFinding[];
}

export interface AuditReport {
  modsChecked: number;
  mods: ModAudit[];
  files: number;
  fixable: number;
  seconds: number;
}

export interface TexState {
  running: boolean;
  phase: "idle" | "scanning" | "converting" | "reverting" | "auditing" | "fixing";
  progress: DdsProgress;
  startedAt: number;
  finishedAt: number;
  errors: [string, string, string][];
  report: DdsReport | null;
}

export interface ModTextures {
  uid: string;
  name: string;
  active: boolean;
  pngs: number;
  dds: number;
  converted: number;
  ddsBytes: number;
  pngBytes: number;
  excluded: boolean;
}

export type ChangeKind = "added" | "removed" | "updated";
export type ChangeReason = "workshopUpdate" | "versionChange" | "filesChanged" | "renamed" | "sourceChanged";

export interface ModChange {
  kind: ChangeKind;
  uid: string;
  name: string;
  packageId: string;
  publishedFileId?: number | null;
  source: Source;
  /** In the active list (for removed mods: was in the list when the baseline was taken). */
  active: boolean;
  reasons: ChangeReason[];
  oldVersion?: string | null;
  newVersion?: string | null;
  /** Unix seconds of the change when known (Workshop update time, else the folder's mtime). */
  when: number;
}

export interface ListChange {
  added: string[];
  removed: string[];
  reordered: boolean;
  /** The mods that moved (the fewest that explain the new order), in their new order. */
  moves?: ListMove[];
}

/** A mod that changed place in ModsConfig.xml; positions are 1-based. */
export interface ListMove {
  packageId: string;
  from: number;
  to: number;
}

export interface UpdateInfo {
  uid: string;
  publishedFileId: number;
  name: string;
  localModified: number;
  remoteUpdated: number;
  source: Source;
}

// ---- downloads ----
export type ItemStatus = "queued" | "downloading" | "done" | "failed" | "cancelled";

export interface QueueItem {
  id: number;
  name?: string;
  status: ItemStatus;
  attempts: number;
  error?: string;
  bytes?: number;
  path?: string;
  addedAt: number;
  finishedAt?: number;
  /** Steam's folder for this item when it is a Force update of a Steam mod. */
  intoSteam?: string;
}

export interface BatchStats {
  requested: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  authFailed: boolean;
  stalled: boolean;
  seconds: number;
}

export interface Throttle {
  batchSize: number;
  cleanStreak: number;
  level: number;
  cooldownUntil: number | null;
  last: BatchStats | null;
}

export interface QueueState {
  items: QueueItem[];
  throttle: Throttle;
  paused: boolean;
  currentBatch: number[];
  currentItem: number | null;
  running: boolean;
  steamcmdInstalled: boolean;
  installing: boolean;
  log: string[];
}

export interface AddResult {
  added: number;
  skipped: [number, string][];
}

export interface SteamCmdStatus {
  installed: boolean;
  installing: boolean;
  root: string;
  exe: string;
  downloadsDir: string;
  consoleLog: string;
  consoleLogBytes: number;
  modsDir: string | null;
  workshopDir: string | null;
  queued: number;
  running: boolean;
  paused: boolean;
  batchSize: number;
  cooldownUntil: number | null;
}

export interface TestOutcome {
  loggedIn: boolean;
  lines: number;
  stalled: boolean;
  exitCode: number | null;
  seconds: number;
}

/** Where one Workshop item stands with Steam: from a subscription, on disk some other way, or absent. */
export type ItemState = "subscribed" | "installed" | "absent";

export interface ItemSubscription {
  id: number;
  state: ItemState;
  timeUpdated?: number;
  path?: string;
}

export interface SteamClientStatus {
  installed: boolean;
  running: boolean;
  steamDir?: string;
  /** Steam's record of RimWorld Workshop items was found, so subscriptions can be read back. */
  recordsFound: boolean;
  detail: string;
}

/** What a subscribe or unsubscribe request did: `opened` means a page was shown, not that Steam acted. */
export interface SubscribeOutcome {
  opened: number[];
  skipped: [number, string][];
  failed: [number, string][];
  note: string;
  client: SteamClientStatus;
  states: ItemSubscription[];
}

/** Steam's record catching up after pages were opened (the `subscription-changed` event). */
export interface SubscriptionProgress {
  states: ItemSubscription[];
  settled: boolean;
  want: "subscribe" | "unsubscribe";
}

export interface CollectionPreview {
  ids: number[];
  installed: [number, string][];
  missing: number[];
  names: Record<string, string>;
}

export interface RentryPreview {
  preview: ImportPreview;
  missingWorkshopIds: number[];
}

export interface ImportedList {
  packageIds: string[];
  gameVersion?: string;
  format: string;
}

export interface ImportPreview {
  list: ImportedList;
  uids: string[];
  missing: string[];
}

export interface RulesFile {
  timestamp: number;
  rules: Rule[];
  ignore: Rule[];
}

export interface ModFiles {
  textures: string[];
  patches: string[];
  defs: string[];
  assemblies: string[];
}

export const PHASES: { id: Phase; name: string; color: string; note: string }[] = [
  { id: "prepatch", name: "Preloads", color: "violet", note: "Harmony, Prepatcher, loaders: before the game itself" },
  { id: "core", name: "Game and DLC", color: "blue", note: "RimWorld's own content" },
  { id: "framework", name: "Libraries", color: "teal", note: "Other mods build on these" },
  { id: "content", name: "Content", color: "green", note: "Things, pawns, biomes, rules" },
  { id: "patch", name: "Patches", color: "pink", note: "Load after the mods they change" },
  { id: "texture", name: "Texture packs", color: "amber", note: "The later pack wins" },
  { id: "late", name: "Late loaders", color: "slate", note: "Asked to load near the bottom, with their add-ons" },
  { id: "optimization", name: "Performance", color: "coral", note: "Load last to see everything" }
];

/** Where players ask for help and report a mod sorted somewhere odd. */
export const DISCORD = "https://discord.gg/JvsdeBw897";

export const SOURCE_LABEL: Record<Source, string> = { ludeon: "Ludeon", workshop: "Steam", local: "Local", steamcmd: "SteamCMD", git: "Git" };
export const SOURCE_GLYPH: Record<Source, string> = { ludeon: "L", workshop: "S", local: "F", steamcmd: "C", git: "G" };

export const BAND_LABEL: Record<Band, string> = {
  negligible: "Negligible",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
  veryheavy: "Very heavy",
  insufficient: "Few runs",
  unknown: "Not measured"
};

export const REASON_LABEL: Record<ChangeReason, string> = {
  workshopUpdate: "updated on the Workshop",
  versionChange: "new version",
  filesChanged: "files changed",
  renamed: "renamed",
  sourceChanged: "comes from a different place now"
};

/** "Updated on the Workshop 3 Sep · v1.2 → v1.3" */
export function describeChange(c: ModChange): string {
  const date = c.when ? new Date(c.when * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  if (c.kind === "added") return `Installed${date ? ` ${date}` : ""}${c.newVersion ? ` · v${c.newVersion}` : ""}${c.active ? " · in your list" : ""}`;
  if (c.kind === "removed") return `No longer installed${c.active ? " · it was in your list" : ""}`;
  const parts: string[] = [];
  const main = c.reasons.find((r) => r === "workshopUpdate") ?? c.reasons[0];
  if (main) parts.push(REASON_LABEL[main].replace(/^./, (ch) => ch.toUpperCase()) + (date ? ` ${date}` : ""));
  if (c.oldVersion !== c.newVersion && (c.oldVersion || c.newVersion)) parts.push(`v${c.oldVersion ?? "?"} → v${c.newVersion ?? "?"}`);
  for (const r of c.reasons) if (r !== main && r !== "versionChange" && r !== "filesChanged") parts.push(REASON_LABEL[r]);
  return parts.join(" · ");
}

/** Bands for a mod's share of the list's estimated loading time. */
export type LoadBand = "negligible" | "light" | "moderate" | "heavy" | "veryheavy";
export function loadBand(share: number): LoadBand {
  return share >= 0.05 ? "veryheavy" : share >= 0.02 ? "heavy" : share >= 0.005 ? "moderate" : share >= 0.001 ? "light" : "negligible";
}
export const LOAD_BAND_LABEL: Record<LoadBand, string> = { negligible: "Negligible", light: "Light", moderate: "Moderate", heavy: "Heavy", veryheavy: "Very heavy" };

export function severityOf(i: Issue): Severity {
  switch (i.kind) {
    case "missingDependency":
    case "incompatible":
    case "cycle":
    case "invalid":
      return "error";
    // Somebody asked for this placement, so it is a warning about what it may cost rather than
    // an error about a list nobody chose.
    case "aboveOfficial":
      return i.declared ? "warning" : "error";
    case "textureCollision":
    case "ruleIgnored":
      return "note";
    default:
      return "warning";
  }
}

export function primaryUid(i: Issue): string | undefined {
  switch (i.kind) {
    case "textureCollision":
      return i.winnerUid;
    case "cycle":
    case "duplicatePackageId":
      return i.uids[0];
    default:
      return i.uid;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function initials(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// ---------------------------------------------------------------- game log analysis

export type LogOutcome = "ok" | "loadFailedReset" | "crashed";

export interface XmlProblem {
  message: string;
  sourceMod?: string | null;
  file?: string | null;
  missingParent?: string | null;
  defName?: string | null;
  line: number;
}

export interface ExceptionGroup {
  message: string;
  topFrame?: string | null;
  modFrame?: string | null;
  patchOwners: string[];
  count: number;
  line: number;
}

export interface DdsFailure {
  path: string;
  reason: string;
  workshopId?: number | null;
  modFolder?: string | null;
  line: number;
}

export interface CrashInfo {
  line: number;
  reason?: string | null;
  frames: string[];
  culpritFrame?: string | null;
  offMainThread: boolean;
  quickstart: boolean;
}

export interface LogReport {
  lines: number;
  gameVersion?: string | null;
  unityVersion?: string | null;
  gpu?: string | null;
  vramMb?: number | null;
  commandLine?: string | null;
  outcome: LogOutcome;
  reset: boolean;
  gaveUp: boolean;
  loadFailure?: ExceptionGroup | null;
  crash?: CrashInfo | null;
  prepatcherVanillaLoadSecs?: number | null;
  prepatcherRestarted: boolean;
  timings: { label: string; seconds: number; line: number }[];
  duplicates: { packageId: string; folders: string[] }[];
  missingParents: XmlProblem[];
  xmlErrors: XmlProblem[];
  exceptions: ExceptionGroup[];
  ddsFailures: DdsFailure[];
  multipleOf4Warnings: Record<string, number>;
  threadTextureWarnings: number;
  texturesNotFound: [string, number][];
  texturesNotFoundTotal: number;
  badTextureMaterials: number;
  quickstart: boolean;
}

export interface LogModRef {
  uid?: string | null;
  name: string;
  active: boolean;
  missingParents: number;
  xmlErrors: number;
  ddsFailures: number;
  exceptions: number;
  exceptionHits: number;
  crashCulprit: boolean;
  loadFailurePatch: boolean;
  duplicateFolders: number;
  aboveOfficial: boolean;
}

export interface LogAnalysis {
  path: string;
  bytes: number;
  modified: number;
  report: LogReport;
  mods: LogModRef[];
  /** Frame namespace / patch owner / source name → mod name. */
  resolved: Record<string, string>;
}

export interface LogFile {
  path: string;
  exists: boolean;
  bytes: number;
  modified: number;
}

// ---------------------------------------------------------------- the merged defs

/** Who put something in the merged document; index 0 is the game's own scaffolding. */
export interface DefOrigin {
  uid: string;
  packageId: string;
  name: string;
  /** The file inside the mod, relative to its folder. */
  file: string;
  index: number;
  isPatch: boolean;
}

/** A value a later mod took over from an earlier one. */
export interface Overwrite {
  /** `ThingDef/Wall`. */
  def: string;
  /** `statBases/MaxHitPoints`, relative to the def. */
  path: string;
  from: number;
  to: number;
  oldValue: string;
  newValue: string;
  /** The operation that did it, or `Defs` for a plain duplicate def. */
  how: string;
  /** The node that changed; histories are followed by node, not by path. */
  node: number;
  /** The node that took its place, the node itself for an in-place change, or NONE when removed. */
  next: number;
}

/** One value's history: who shipped it, then everyone who changed it, in load order. */
export interface Chain {
  def: string;
  defType: string;
  defName: string;
  path: string;
  steps: ChainStep[];
  /** Several list items removed by one mod, folded into this one row: what went. */
  removed?: string[];
}

export interface ChainStep {
  origin: number;
  value: string;
  /** `Defs` for the value as shipped, else the operation. */
  how: string;
}

export interface PatchProblem {
  origin: number;
  xpath: string;
  class: string;
  reason: string;
  /** The operation says a miss is fine, so this is information rather than a fault. */
  tolerated: boolean;
}

export interface DefDuplicate {
  defType: string;
  defName: string;
  origins: number[];
  winner: number;
}

export interface DefModStats {
  uid: string;
  name: string;
  defs: number;
  values: number;
  wins: number;
  losses: number;
  operations: number;
  failedOperations: number;
}

export interface DefsReport {
  origins: DefOrigin[];
  defs: number;
  values: number;
  operations: number;
  overwrites: Overwrite[];
  /** `overwrites` followed by node into the histories the view shows. */
  chains: Chain[];
  problems: PatchProblem[];
  duplicates: DefDuplicate[];
  perMod: DefModStats[];
  missingParents: string[];
  elapsedMs: number;
}

export interface DefsState {
  running: boolean;
  /** idle | defs | patches | inheritance */
  phase: string;
  done: number;
  total: number;
  /** The mod being read right now. */
  current: string;
  startedAt: number;
  finishedAt: number;
  stopped: boolean;
  error: string | null;
  report: DefsReport | null;
}

/** One node an XPath selected: which def it is in, where inside it, and whose it is. */
export interface DefMatch {
  def: string;
  defType: string;
  defName: string;
  path: string;
  value: string;
  origin: number;
  inherited: boolean;
}

export interface DefQuery {
  /** How many the xpath matched, which can be more than were returned. */
  total: number;
  matches: DefMatch[];
  elapsedMs: number;
}

export interface DefNode {
  tag: string;
  path: string;
  value: string;
  leaf: boolean;
  /** 0 for the def's own children. */
  depth: number;
  origin: number;
  inherited: boolean;
  inheritedFrom: string;
  attrs: [string, string][];
}

export interface DefTree {
  defType: string;
  defName: string;
  origin: number;
  nodes: DefNode[];
  truncated: number;
}

/** A marker colour per origin, so a mod keeps the same colour everywhere in the view. */
export const ORIGIN_COLORS = ["blue", "green", "violet", "teal", "pink", "coral", "amber", "slate", "red"] as const;
export function originColor(origin: number): string {
  return ORIGIN_COLORS[origin % ORIGIN_COLORS.length];
}

// ---------------------------------------------------------------- code patches (Harmony)

/** One patch method in a mod's assembly, and the game method it attaches to. */
export interface PatchTarget {
  declaringType: string;
  method: string;
  /** prefix | postfix | transpiler | finalizer | reverse | patch | unpatch. */
  kind: string;
  targetType: string | null;
  targetMethod: string | null;
  /** normal | getter | setter | constructor | staticConstructor | enumerator | async. */
  targetKind: string;
  argumentTypes: string[] | null;
  priority: number | null;
  before: string[];
  after: string[];
  /** attribute | manual. */
  source: string;
}

/** One mod patching one game method. */
export interface Patcher {
  uid: string;
  modName: string;
  kind: string;
  declaringType: string;
  method: string;
  priority: number | null;
  before: string[];
  after: string[];
}

/** A game method and everyone who patches it. */
export interface TargetGroup {
  /** `RimWorld.Pawn::Tick`. */
  target: string;
  patchers: Patcher[];
  /** Two mods prefix it, or two mods transpile it. Postfixes stack and do not count. */
  contested: boolean;
}

export interface ModPatches {
  uid: string;
  name: string;
  assemblies: number;
  patches: number;
  prefixes: number;
  postfixes: number;
  transpilers: number;
  /** Places that patch in a way static reading cannot follow. */
  manual: number;
  harmonyIds: string[];
  /** Assemblies that could not be read, with the reason. */
  unreadable: string[];
}

export interface PatchReport {
  perMod: ModPatches[];
  targets: TargetGroup[];
  contested: number;
  scanned: number;
}

export interface PatchSummary {
  mods: number;
  assemblies: number;
  targets: number;
  contested: number;
  unreadable: number;
  seconds: number;
}

export interface PatchJob {
  running: boolean;
  phase: "idle" | "collecting" | "scanning";
  done: number;
  total: number;
  current: string;
  startedAt: number;
  finishedAt: number;
  cancelled: boolean;
  error: string | null;
  summary: PatchSummary | null;
}

/** A place that patches in a way reading the metadata cannot follow. */
export interface ManualPatch {
  declaringType: string;
  method: string;
  detail: string;
}

export interface ModPatchDetail {
  summary: ModPatches;
  targets: PatchTarget[];
  manual: ManualPatch[];
  contested: TargetGroup[];
}

/** The method a patch attaches to, written the way the game writes it. */
export function patchTargetName(p: PatchTarget): string {
  const ty = p.targetType ?? "?";
  const method = p.targetMethod ?? (p.targetKind === "constructor" ? ".ctor" : p.targetKind === "staticConstructor" ? ".cctor" : "?");
  if (p.targetKind === "getter") return `${ty}::get_${method}`;
  if (p.targetKind === "setter") return `${ty}::set_${method}`;
  return `${ty}::${method}`;
}

/** `RimWorld.Pawn::Tick` split into the type and the method, so a long name can wrap sensibly. */
export function splitTarget(target: string): [string, string] {
  const i = target.lastIndexOf("::");
  return i < 0 ? ["", target] : [target.slice(0, i), target.slice(i + 2)];
}

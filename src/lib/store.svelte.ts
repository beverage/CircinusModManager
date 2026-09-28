// Application state for the UI (Svelte 5 runes). One snapshot from the backend, derived
// indexes for fast lookups, and the actions the components call.

import { api, appVersion, listen, openFolder } from "./api";
import { t } from "./i18n.svelte";
import type { AuditReport, BuiltinRule, CollectionPreview, DefMatch, DefQuery, DefsState, DefTree, Group, HaloRules, ImportPreview, Instance, Issue, ItemState, LaunchSettings, Locations, LogAnalysis, LogFile, ModChange, ModInfo, ModPatchDetail, ModTextures, PatchJob, PatchReport, Phase, Placement, QueueState, RentryPreview, Rule, Settings, Snapshot, SortResult, Source, SteamClientStatus, SteamCmdStatus, SubscribeOutcome, SubscriptionProgress, TexState, TrackedCollection, UpdateCheck, UpdateProgress, UserData, Weight } from "./types";
import { EMPTY_HALO, GROUP_COLORS, loadBand, PHASES, primaryUid, severityOf, type LoadBand, type Severity } from "./types";

export type View = "order" | "library" | "downloads" | "textures" | "defs" | "patches" | "analyzer" | "halo" | "settings";

export type Tab = "active" | "inactive" | "all" | "new";

/** Which part of the patch report is on screen. The report answers four different questions and
 *  each answer is a list of thousands, so they are four screens rather than one page nobody can
 *  find the bottom of. It lives here rather than in the component because leaving the view
 *  destroys the component, and coming back to a different tab than you left is the same
 *  complaint as coming back to the top of a list you were halfway down. */
export type PatchesTab = "overview" | "contested" | "methods" | "permod" | "manual";

/** What the per-mod table is ordered by. */
export type PatchesCol = "name" | "patches" | "prefixes" | "postfixes" | "transpilers" | "manual";

/** What the list is ordered by. `order` is the load order, which is the only one that is real:
 *  every other value sorts the view without touching what the game will read. */
export type SortKey = "order" | "name" | "pkg" | "versions" | "time" | "load" | "cost" | "phase" | "group" | "arrived" | "modified" | "updated" | "steamid";

/** Every way the list can be ordered, in the order the Sort menu offers them.
 *
 *  The list has always sorted by clicking a column heading, which works right up until you want
 *  to sort by something that is not a column -- when a folder last changed, when Steam last
 *  published, which Workshop item it is. Those have no heading to click, so the menu is where
 *  they live, and it carries the column sorts too rather than being a second place to look.
 *
 *  Keys only: the words live in the catalogue, and a module constant that called `t()` would
 *  capture whatever locale was current when the file first loaded and never change again. */
/** The sorts that start A to Z rather than largest first. */
const ASCENDING_FIRST = new Set<SortKey>(["name", "pkg", "group"]);

export const SORTS: SortKey[] = ["order", "name", "pkg", "versions", "time", "load", "cost", "phase", "group", "arrived", "modified", "updated", "steamid"];
export const sortLabel = (k: SortKey) => t(`sort.${k}.label`);
export const sortHint = (k: SortKey) => t(`sort.${k}.hint`);
/** Which list one pane of a side-by-side view shows. `null` is the ordinary single list, where
 *  the tabs decide what is in it. */
export type Pane = "inactive" | "active";
/** The two comparisons: your library (inactive beside active) and the order you have now beside
 *  the one HALO proposes. */
export type Split = "library" | "halo";
/** What the list is narrowed to: mods with errors, warnings, HALO notes, conflicts, changes, or moves. */
export type ShowOnly = "attention" | "error" | "warning" | "note" | "conflict" | "collision" | "heavy" | "slow" | "changed" | "moved" | null;

const ALL_SOURCES: Source[] = ["ludeon", "workshop", "local", "steamcmd", "git"];

class Store {
  snap = $state<Snapshot | null>(null);
  loading = $state(true);
  busy = $state<string | null>(null);
  progress = $state<{ phase: "read" | "inspect"; done: number; total: number } | null>(null);
  error = $state<string | null>(null);
  /** What the loader is doing right now, shown on the startup overlay. */
  step = $state("Connecting to the app");
  toast = $state<{ msg: string; kind: "ok" | "warn" | "err" } | null>(null);

  view = $state<View>("order");
  /** Where each scrolling view was left.
   *
   *  `App.svelte` chooses a view with `{#if}`, so switching away destroys the component and
   *  everything local to it, and coming back mounts a fresh one at the top. Halfway down a
   *  thousand-mod list that is the whole position gone for looking at one group. The key is a
   *  scope ("order:main", "defs"), the value is enough to put the same row back under the same
   *  pixel.
   *
   *  Deliberately not `$state`: it is written on every scroll event and read once on mount, so
   *  reactivity would buy nothing and cost a re-run of every reader per wheel tick. */
  readonly scrollMemory = new Map<string, { anchor: string | null; delta: number; top: number }>();
  tab = $state<Tab>("active");
  // The patch report's own place: which tab, what was typed in its filter, which mod was open
  // and how its table was sorted. Same reason as `scrollMemory` -- the view is destroyed on the
  // way to a mod and rebuilt on the way back, and none of this is worth doing twice.
  patchesTab = $state<PatchesTab>("overview");
  patchesQuery = $state("");
  patchesSort = $state<{ by: PatchesCol; desc: boolean }>({ by: "patches", desc: true });
  patchesOpen = $state<string | null>(null);
  query = $state("");
  group = $state<string | null>(null);
  sources = $state<Source[]>([...ALL_SOURCES]);
  onlyCurrentVersion = $state(false);
  showOnly = $state<ShowOnly>(null);
  selected = $state<string[]>([]);
  /** Off, or the two lists shown side by side. */
  split = $state<Split | null>(null);
  preview = $state<SortResult | null>(null);
  importPreview = $state<ImportPreview | null>(null);
  collectionPreview = $state<CollectionPreview | null>(null);
  rentryPreview = $state<RentryPreview | null>(null);
  showImport = $state(false);
  showChanges = $state(false);
  downloads = $state<QueueState | null>(null);
  /** Why the download manager could not be reached, when it could not. */
  downloadsError = $state<string | null>(null);
  steamcmd = $state<SteamCmdStatus | null>(null);
  /** Whether the Steam client is here and running, for the actions that need it. */
  steamClient = $state<SteamClientStatus | null>(null);
  /** Workshop id → what Steam says about it, as far as we have looked. */
  subscriptions = $state<Record<number, ItemState>>({});
  /** Texture optimisation job state (from `dds-progress`). */
  tex = $state<TexState | null>(null);
  texOverview = $state<ModTextures[]>([]);
  /** Last DDS audit: foreign files the game will refuse. */
  audit = $state<AuditReport | null>(null);
  /** The Harmony scan job (from `patch-progress`) and what it found. */
  patchJob = $state<PatchJob | null>(null);
  patchReport = $state<PatchReport | null>(null);
  /** Notices closed for this session (they come back next launch if still true). */
  dismissed = $state<string[]>([]);
  /** The list should scroll to a mod on the next render: which mod, which pane is being asked
   *  (`null` is the ordinary single list), and whether the row takes focus when it arrives. */
  scrollRequest = $state<{ uid: string; pane: Pane | null; focus: boolean } | null>(null);
  /** The drag in flight, shared so one pane can draw a drop line for mods picked up in the other. */
  drag = $state<{ uids: string[]; from: Pane | null } | null>(null);
  /** Where a drag would land: which pane, and either a row to drop beside or the end of the list. */
  drop = $state<{ pane: Pane | null; uid?: string; after?: boolean; end?: boolean } | null>(null);
  /** The right-click menu, when open: where, and for which mods. */
  menu = $state<{ x: number; y: number; uids: string[] } | null>(null);
  /** The collection panel, when open: which followed collection. */
  showCollection = $state<number | null>(null);
  showAnnouncements = $state(false);
  showPalette = $state(false);
  showKeys = $state(false);

  /** What Escape closes, and in what order.
   *
   *  Escape used to be five `svelte:window` listeners in five files, each closing its own local
   *  boolean, none of them stopping the others. Closing the sort menu with Escape therefore also
   *  ran App's branch and cleared the selection behind it -- and, worse, silently discarded a
   *  HALO preview, which is a destructive act on the most-pressed key in the application.
   *
   *  So: one handler, and things register what they are. The highest rank that is open wins and
   *  Escape stops there. Deliberately not `$state`: it is a registry, read in an event handler,
   *  and making it reactive would re-run every reader whenever a menu opened. */
  readonly dismissers: { id: string; rank: number; open: () => boolean; close: () => void }[] = [];
  /** Register while mounted; the returned function unregisters. (`dismiss` is taken: that one
   *  hides a banner for the session, which is a different verb wearing the same word.) */
  onEscape(id: string, rank: number, open: () => boolean, close: () => void) {
    const row = { id, rank, open, close };
    this.dismissers.push(row);
    return () => {
      const i = this.dismissers.indexOf(row);
      if (i >= 0) this.dismissers.splice(i, 1);
    };
  }
  /** Close the topmost open thing. True when something was closed, so the caller knows whether
   *  to swallow the key. */
  escape(): boolean {
    const open = this.dismissers.filter((d) => d.open()).sort((a, b) => b.rank - a.rank);
    if (open.length) {
      open[0].close();
      return true;
    }
    if (this.selected.length) {
      this.selected = [];
      return true;
    }
    return false;
  }
  /** The instances dialog, when open. */
  showInstances = $state(false);
  /** Last Player.log analysis, and the logs RimWorld writes on this machine. */
  gameLog = $state<LogAnalysis | null>(null);
  gameLogFiles = $state<LogFile[]>([]);
  /** The def flattening job: what it is doing and, when it is done, its report. */
  defs = $state<DefsState | null>(null);
  /** The def the inspector is showing, and the path within it to point at. */
  defsTree = $state<DefTree | null>(null);
  defsFocus = $state<string | null>(null);
  /** Defs whose name matched the search box. */
  defsFound = $state<DefMatch[]>([]);
  /** The last raw XPath query, for the advanced box. */
  defsQuery = $state<DefQuery | null>(null);
  defsError = $state<string | null>(null);
  /** The version this build is; asked of the app once, so Settings can show it before any check. */
  appVersion = $state<string | null>(null);
  /** The newer Circinus circinus.sh offers, once a check found one. */
  update = $state<UpdateCheck | null>(null);
  /** What the last check concluded, in words, for Settings. */
  updateStatus = $state<{ text: string; kind: "ok" | "err" } | null>(null);
  updateChecking = $state(false);
  /** How far the install in hand has come (from `update-progress`); null when none is running. */
  updateProgress = $state<UpdateProgress | null>(null);

  // ---- derived indexes ----
  mods = $derived.by(() => {
    // Defensive: a repeated uid would break keyed lists, so keep the first of any duplicate.
    const seen = new Set<string>();
    return (this.snap?.mods ?? []).filter((m) => (seen.has(m.uid) ? false : (seen.add(m.uid), true)));
  });
  byUid = $derived(new Map(this.mods.map((m) => [m.uid, m])));
  byPackage = $derived(new Map(this.mods.filter((m) => m.packageId).map((m) => [m.packageId, m])));
  active = $derived.by(() => {
    const seen = new Set<string>();
    return (this.snap?.active ?? []).filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  });
  activeSet = $derived(new Set(this.active));
  indexOf = $derived(new Map(this.active.map((u, i) => [u, i])));
  placementByUid = $derived(new Map((this.snap?.placements ?? []).map((p) => [p.uid, p])));
  issues = $derived(this.snap?.issues ?? []);
  issuesByUid = $derived.by(() => {
    const map = new Map<string, Issue[]>();
    for (const i of this.issues) {
      const uids = i.kind === "textureCollision" || i.kind === "cycle" || i.kind === "duplicatePackageId" ? i.uids : [i.uid];
      for (const u of uids) {
        if (!map.has(u)) map.set(u, []);
        map.get(u)!.push(i);
      }
    }
    return map;
  });
  groupsById = $derived(new Map((this.snap?.user.groups ?? []).map((g) => [g.id, g])));
  /** Groups that find members on their own, in the order they are listed: the first match wins. */
  autoGroups = $derived((this.snap?.user.groups ?? []).filter((g) => g.auto));
  /** The group a mod falls into by a group's own rule (the game and DLC, a HALO phase, an author). */
  autoGroupOf(uid: string): Group | undefined {
    const m = this.byUid.get(uid);
    if (!m) return undefined;
    for (const g of this.autoGroups) {
      const r = g.auto!;
      if (r.kind === "official" && m.source === "ludeon") return g;
      if (r.kind === "phase" && this.placementByUid.get(uid)?.phase === r.phase) return g;
      if (r.kind === "author" && r.name.trim() && (m.authors ?? []).some((a) => a.toLowerCase().includes(r.name.trim().toLowerCase()))) return g;
    }
    return undefined;
  }
  /** A mod's group: the one it was put in by hand, else the one whose rule takes it. */
  groupOf = (uid: string): Group | undefined => this.groupsById.get(this.snap?.user.modGroups[uid] ?? "") ?? this.autoGroupOf(uid);
  /** Members per group, hand-picked and automatic together. */
  groupCounts = $derived.by(() => {
    const c = new Map<string, number>();
    for (const m of this.mods) {
      const g = this.groupOf(m.uid);
      if (g) c.set(g.id, (c.get(g.id) ?? 0) + 1);
    }
    return c;
  });
  /** The active list shown in HALO's phase sections (true) or as the plain load order (false). */
  byPhase = $derived(this.snap?.settings.listByPhase ?? false);
  /** Column widths the user dragged, CSS px, by key; absent = the default. */
  columns = $derived(this.snap?.settings.columns ?? {});
  /** The optional list columns that are on. */
  listColumns = $derived(this.snap?.settings.listColumns ?? ["time", "load", "versions"]);
  /** Each active mod's estimated share of the list's loading time, from the folder figures. */
  loadShares = $derived.by(() => {
    const out = new Map<string, { share: number; band: LoadBand; ms: number }>();
    let total = 0;
    for (const uid of this.active) total += this.byUid.get(uid)?.contents.load?.scoreMs ?? 0;
    for (const m of this.mods) {
      const ms = m.contents.load?.scoreMs ?? 0;
      const share = total > 0 && this.activeSet.has(m.uid) ? ms / total : 0;
      out.set(m.uid, { share, band: loadBand(share), ms });
    }
    return out;
  });
  loadOf = (uid: string) => this.loadShares.get(uid);
  /** Total estimated loading time of the active list, in seconds; a model, not a measurement. */
  loadTotalSeconds = $derived.by(() => {
    let total = 0;
    for (const uid of this.active) total += this.byUid.get(uid)?.contents.load?.scoreMs ?? 0;
    return total / 1000;
  });
  /** The user's HALO rules, always present. */
  halo = $derived<HaloRules>(this.snap?.user.halo ?? EMPTY_HALO);
  /** HALO's built-in rule table, fetched once for the HALO page. */
  haloRules = $state<BuiltinRule[]>([]);
  async loadHaloRules() {
    if (this.haloRules.length) return;
    try {
      this.haloRules = await api.haloRules();
    } catch (e) {
      console.warn("[circinus] halo_rules failed", e);
    }
  }
  updateHalo(patch: (h: HaloRules) => HaloRules) {
    return this.updateUser((u) => ({ ...u, halo: patch(structuredClone(u.halo ?? EMPTY_HALO)) }));
  }
  weightOf = (m: ModInfo): Weight | undefined => this.snap?.weights[m.packageId];
  pinned = $derived(new Set(this.snap?.user.pinned ?? []));
  showWeight = $derived(this.snap?.settings.showWeight ?? false);
  updateByUid = $derived(new Map((this.snap?.updates ?? []).map((u) => [u.uid, u])));
  changes = $derived(this.snap?.changes ?? []);
  changeByUid = $derived(new Map(this.changes.map((c) => [c.uid, c])));
  /** When each mod first appeared, for the ones that appeared while Circinus was watching. A mod
   *  that was already installed the first time we looked has no arrival date, which is not the
   *  same as having arrived a long time ago. */
  firstSeenByUid = $derived(new Map(Object.entries(this.snap?.firstSeen ?? {})));
  /** The mods still worth marking new, most recent first. The backend decides what counts, so
   *  the mark on a row, the count on the tab and the list behind it cannot disagree. */
  newUids = $derived(this.snap?.newUids ?? []);
  newSet = $derived(new Set(this.newUids));
  isNew = (uid: string) => this.newSet.has(uid);
  listChange = $derived(this.snap?.listChange ?? null);
  changeCounts = $derived.by(() => {
    const n = (k: ModChange["kind"]) => this.changes.filter((c) => c.kind === k).length;
    return { updated: n("updated"), added: n("added"), removed: n("removed"), total: this.changes.length };
  });
  /** "3 updated, 1 new, 2 removed" */
  changeSummary = $derived.by(() => {
    const c = this.changeCounts;
    return [c.updated ? `${c.updated} updated` : "", c.added ? `${c.added} new` : "", c.removed ? `${c.removed} removed` : ""].filter(Boolean).join(", ");
  });
  steamcmdReady = $derived(this.downloads?.steamcmdInstalled ?? false);
  ddsOf = (uid: string) => this.snap?.dds?.[uid];
  ddsTotals = $derived.by(() => {
    let mods = 0, files = 0, ddsBytes = 0, pngBytes = 0, vramBefore = 0;
    for (const s of Object.values(this.snap?.dds ?? {})) { mods++; files += s.count; ddsBytes += s.ddsBytes; pngBytes += s.pngBytes; vramBefore += s.vramBefore; }
    return { mods, files, ddsBytes, pngBytes, vramBefore };
  });
  queueCounts = $derived.by(() => {
    const items = this.downloads?.items ?? [];
    return { queued: items.filter((i) => i.status === "queued" || i.status === "downloading").length, failed: items.filter((i) => i.status === "failed").length, done: items.filter((i) => i.status === "done").length };
  });
  rulesBySubject = $derived.by(() => {
    const map = new Map<string, Rule[]>();
    for (const r of this.snap?.rules ?? []) {
      for (const key of [r.subject, r.target]) {
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(r);
      }
    }
    return map;
  });
  moveOf = $derived.by(() => {
    const map = new Map<string, number>();
    if (this.preview) for (const [uid, from, to] of this.preview.moves) map.set(uid, to - from);
    return map;
  });

  // ---- counts for the stat tiles ----
  stats = $derived.by(() => {
    const errors = this.issues.filter((i) => severityOf(i) === "error").length;
    const warnings = this.issues.filter((i) => severityOf(i) === "warning").length;
    const collisions = this.issues.filter((i) => i.kind === "textureCollision");
    const collidingMods = new Set(collisions.flatMap((c) => c.uids)).size;
    const orderRules = (this.snap?.rules ?? []).filter((r) => (r.kind === "loadAfter" || r.kind === "loadBefore") && this.byPackage.has(r.subject) && r.target && this.byPackage.has(r.target) && this.activeSet.has(this.byPackage.get(r.subject)!.uid) && this.activeSet.has(this.byPackage.get(r.target)!.uid)).length;
    const violations = this.issues.filter((i) => i.kind === "orderViolation").length;
    const satisfied = orderRules ? Math.max(0, orderRules - violations) : 0;
    // Figures: a mod "has figures" when the site knows it at all (a band), and contributes to the
    // total when it has a number.
    let share = 0, measured = 0, withShare = 0;
    for (const uid of this.active) {
      const m = this.byUid.get(uid);
      const w = m && this.weightOf(m);
      if (w && w.band !== "unknown") measured++;
      if (w?.share != null) { share += w.share; withShare++; }
    }
    return { errors, warnings, collisions: collisions.length, collidingMods, orderRules, violations, satisfied, pct: orderRules ? Math.floor((satisfied / orderRules) * 1000) / 10 : 100, share, measured, withShare };
  });

  // ---- filtering ----
  matches(m: ModInfo): boolean {
    const q = this.query.trim().toLowerCase();
    if (q && !((m.name ?? "").toLowerCase().includes(q) || (m.packageId ?? "").includes(q) || (m.authors ?? []).some((a) => a.toLowerCase().includes(q)) || String(m.publishedFileId ?? "").includes(q))) return false;
    if (this.group && this.groupOf(m.uid)?.id !== this.group) return false;
    if (!this.sources.includes(m.source)) return false;
    if (this.onlyCurrentVersion && m.source !== "ludeon" && !(m.supportedVersions ?? []).includes(this.snap?.gameVersion.majorMinor ?? "")) return false;
    if (this.showOnly && !this.passesShowOnly(m.uid, this.showOnly)) return false;
    return true;
  }
  /** Whether a mod belongs to a "show only" set. */
  passesShowOnly(uid: string, what: Exclude<ShowOnly, null>): boolean {
    const list = this.issuesByUid.get(uid) ?? [];
    switch (what) {
      case "attention": return list.some((i) => severityOf(i) !== "note");
      case "error": return list.some((i) => severityOf(i) === "error");
      case "warning": return list.some((i) => severityOf(i) === "warning");
      case "note": return list.some((i) => severityOf(i) === "note");
      case "conflict": return list.some((i) => i.kind === "incompatible" || i.kind === "orderViolation" || i.kind === "cycle" || i.kind === "aboveOfficial");
      case "collision": return list.some((i) => i.kind === "textureCollision");
      case "heavy": {
        const m = this.byUid.get(uid);
        const w = m && this.weightOf(m);
        return !!w && (w.band === "heavy" || w.band === "veryheavy");
      }
      case "slow": {
        const l = this.loadShares.get(uid);
        return !!l && (l.band === "heavy" || l.band === "veryheavy");
      }
      case "changed": return this.changeByUid.has(uid);
      case "moved": return this.moveOf.has(uid);
    }
  }
  /** How many mods each "show only" choice would keep, for the menu. */
  showOnlyCounts = $derived.by(() => {
    const out: Record<Exclude<ShowOnly, null>, number> = { attention: 0, error: 0, warning: 0, note: 0, conflict: 0, collision: 0, heavy: 0, slow: 0, changed: 0, moved: 0 };
    for (const m of this.mods) for (const k of Object.keys(out) as (keyof typeof out)[]) if (this.passesShowOnly(m.uid, k)) out[k]++;
    return out;
  });
  // ---- sorting ----
  /** What the list is ordered by, and which way. `order` means the load order, and it is the
   *  default because it is the only ordering that is true of anything outside the window. */
  sortKey = $state<SortKey>("order");
  sortDir = $state<1 | -1>(1);
  /** Whether the list is showing something other than the order the game will load. */
  sorted = $derived(this.sortKey !== "order");
  /** Click a column: sort by it, or turn it round, or go back to the load order. Three states
   *  rather than two, because a sort has to be escapable from the thing that started it. */
  sortBy(k: SortKey) {
    if (this.sortKey !== k) {
      this.sortKey = k;
      // Words read best A to Z; a measure or a date reads best largest first, since that is the
      // one you are looking for. Group is a name, and was on the wrong side of this line.
      this.sortDir = ASCENDING_FIRST.has(k) ? 1 : -1;
      return;
    }
    if (this.sortDir === (ASCENDING_FIRST.has(k) ? 1 : -1)) this.sortDir = this.sortDir === 1 ? -1 : 1;
    else this.clearSort();
  }
  clearSort() {
    this.sortKey = "order";
    this.sortDir = 1;
  }
  /** "1.6" as a number that sorts, so 1.10 comes after 1.9 rather than before it. */
  private versionRank(v: string): number {
    const [maj, min] = v.split(".").map((n) => Number(n) || 0);
    return (maj ?? 0) * 1000 + (min ?? 0);
  }
  /** The value a mod sorts on. Undefined sorts last whichever way round the column is, because
   *  "no answer" is not a small answer. */
  private sortValue(m: ModInfo): string | number | undefined {
    switch (this.sortKey) {
      case "name": return (m.name ?? "").toLowerCase();
      case "pkg": return (m.packageId ?? "").toLowerCase();
      // The newest game version the mod claims. A list sorted by "versions" is being asked
      // which mods are furthest behind, and the highest number is what answers that.
      case "versions": return (m.supportedVersions ?? []).map((v) => this.versionRank(v)).reduce((a, b) => Math.max(a, b), -1);
      // Time and Load are the same measurement, one in seconds and one as a share of the list,
      // so they sort identically. Both are here rather than one aliasing the other, because a
      // column that quietly sorts by a different column is a surprise waiting to happen.
      case "time": return this.loadOf(m.uid)?.ms;
      case "load": return this.loadOf(m.uid)?.ms;
      // A null share is a mod circinus.sh has no measurement for, which sorts with the ones
      // that have no weight at all rather than as a zero.
      case "cost": return this.weightOf(m)?.share ?? undefined;
      case "phase": return PHASES.findIndex((p) => p.id === (this.placement(m.uid)?.phase ?? "content"));
      case "group": return this.groupOf(m.uid)?.name?.toLowerCase();
      case "arrived": return this.firstSeenByUid.get(m.uid);
      // The files on disk, and what Steam published, are different questions: `modified` is the
      // newest thing seen in the folder, `updated` is Steam's own word about the author. A zero
      // is "Steam has never updated this", which is an absent answer rather than an old one, so
      // it sorts with the mods that have no answer at all instead of as 1970.
      case "modified": return m.modified || undefined;
      case "updated": return m.updated || undefined;
      case "steamid": return m.publishedFileId ?? undefined;
      default: return undefined;
    }
  }
  /** Order a list of mods by the current sort, leaving it alone when there is none. Sorting the
   *  mods rather than the sections is what makes "by phase" sort within each section and the
   *  plain load order sort as one table: the sections are built by filtering this list, and a
   *  filter keeps the order it was given. */
  private applySort(mods: ModInfo[]): ModInfo[] {
    if (!this.sorted) return mods;
    const dir = this.sortDir;
    return [...mods].sort((a, b) => {
      const x = this.sortValue(a);
      const y = this.sortValue(b);
      if (x === undefined && y === undefined) return (a.name ?? "").localeCompare(b.name ?? "");
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      // Name breaks every tie, so the order does not wander between renders when a column has
      // the same value for hundreds of mods, which most of them do.
      return c * dir || (a.name ?? "").localeCompare(b.name ?? "");
    });
  }

  visibleActive = $derived(this.applySort(this.active.map((u) => this.byUid.get(u)!).filter((m) => m && this.matches(m))));
  inactive = $derived(this.mods.filter((m) => !this.activeSet.has(m.uid)).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")));
  visibleInactive = $derived(this.applySort(this.inactive.filter((m) => this.matches(m))));
  /** The mods that arrived recently, newest first unless the user has sorted them otherwise. */
  visibleNew = $derived.by(() => {
    const rows = this.newUids.map((u) => this.byUid.get(u)).filter((m): m is ModInfo => !!m && this.matches(m));
    return this.sorted ? this.applySort(rows) : rows;
  });
  /** Groups with their own place in the load order, in the order they follow one another. */
  sectionGroups = $derived((this.snap?.user.groups ?? []).filter((g) => g.section && g.phase));
  /** An order laid out for the list: each phase's ordinary members, then the groups placed after
   *  it. Used for the order you have and, with HALO's placements, for the one it proposes. */
  private layout(mods: ModInfo[], where: Map<string, Placement>) {
    const out: { phase: (typeof PHASES)[number]; group?: Group; mods: ModInfo[] }[] = [];
    for (const p of PHASES) {
      const inPhase = mods.filter((m) => (where.get(m.uid)?.phase ?? "content") === p.id);
      const plain = inPhase.filter((m) => !where.get(m.uid)?.section);
      if (plain.length) out.push({ phase: p, mods: plain });
      for (const g of this.sectionGroups.filter((g) => g.phase === p.id)) {
        const mods = inPhase.filter((m) => where.get(m.uid)?.section === g.id);
        if (mods.length) out.push({ phase: p, group: g, mods });
      }
    }
    return out;
  }
  /** The load order as shown: each phase's ordinary members, then the groups placed after it. */
  sections = $derived(this.layout(this.visibleActive, this.placementByUid));
  /** Where HALO would file each mod while a preview is up. */
  proposedPlacementByUid = $derived(new Map((this.preview?.placements ?? []).map((p) => [p.uid, p])));
  /** The split actually in effect: the HALO comparison needs a preview to compare against. */
  splitMode = $derived<Split | null>(this.split === "halo" && !this.preview ? null : this.split);
  selectedMod = $derived(this.selected.length ? this.byUid.get(this.selected[this.selected.length - 1]) : undefined);

  // ---- lifecycle ----
  async load() {
    this.loading = true;
    const t0 = performance.now();
    const log = (msg: string) => console.info(`[circinus] ${msg} (+${Math.round(performance.now() - t0)} ms)`);
    // Listeners first: the first snapshot waits for the quick scan, and progress must show meanwhile.
    try {
      await listen<{ phase: "read" | "inspect"; done: number; total: number }>("scan-progress", (p) => (this.progress = p.done >= p.total ? null : p));
      await listen("state-changed", () => this.refresh());
      await listen<string>("scan-error", (e) => this.say(e, "err"));
      await listen<QueueState>("download-progress", (q) => (this.downloads = q));
      await listen<TexState>("dds-progress", (t) => this.onTex(t));
      await listen<DefsState>("defs-progress", (d) => this.onDefs(d));
      await listen<PatchJob>("patch-progress", (j) => this.onPatchJob(j));
      await listen<SubscriptionProgress>("subscription-changed", (p) => this.onSubscription(p));
      await listen<UpdateCheck>("update-available", (c) => this.onUpdateFound(c));
      await listen<UpdateProgress>("update-progress", (p) => (this.updateProgress = p));
      log("event listeners ready");
    } catch (e) {
      log(`event listeners failed: ${e}`);
      this.error = `Could not connect to the app's event system: ${e}`;
    }
    appVersion().then((v) => (this.appVersion = v)).catch(() => {});
    this.step = "Reading your mods";
    let snap: Snapshot | null = null;
    try {
      snap = await api.snapshot();
      log(`snapshot received: ${snap.mods.length} mods, ${snap.active.length} active, ${snap.issues.length} issues`);
      this.error = null;
    } catch (e) {
      // Nothing to draw. Stop here rather than carrying on into a render with no data: the app
      // was written for a snapshot that is late, not for one that never comes, and going on
      // anyway is how a failure at this point turned into a blank window instead of a sentence.
      log(`snapshot failed: ${e}`);
      this.error = String(e);
      this.loading = false;
      api.logFromTheWindow(`the first snapshot could not be read: ${e}`, e instanceof Error ? e.stack : undefined).catch(() => {});
      return;
    }
    // A snapshot from before the first scan finished (the window can be up before the scan
    // thread has the lock) is empty: keep the overlay up and let `state-changed` deliver the
    // real one. If nothing arrives, ask for a scan outright.
    if (snap && this.accept(snap) && !snap.scannedAt) {
      log("snapshot predates the first scan; waiting for it");
      this.snap = snap;
      this.step = "Reading your mods";
      setTimeout(() => {
        if (this.loading && !this.snap?.scannedAt) {
          log("no scan reported after 20 s; asking for one");
          this.rescan(false).finally(() => (this.loading = false));
        }
      }, 20_000);
      this.refreshDownloads();
      return;
    }
    // Drop the overlay first, then apply the data: even if a panel throws while rendering,
    // its boundary shows the error and the rest of the app stays usable.
    this.loading = false;
    // Refused rather than rendered: the first snapshot is no more trustworthy than the others,
    // and a bad one used to reach a `$derived` and take the window down before anything had a
    // chance to say why.
    if (snap && this.accept(snap)) {
      this.snap = snap;
      queueMicrotask(() => log("first render scheduled"));
      this.announceChanges(snap);
    }
    this.refreshDownloads();
    this.refreshTextures();
    // Cheap when nothing has been scanned, and it is what puts a Patches section in the
    // Inspector without the user having opened the Patches view first.
    this.refreshPatches();
    this.refreshInstances();
  }

  private announceChanges(snap: Snapshot) {
    if (snap.changes.length) setTimeout(() => this.say(`${snap.changes.length} mod${snap.changes.length === 1 ? "" : "s"} changed since you last opened Circinus: ${this.changeSummary}`, "warn"), 400);
    else if (snap.listChange) setTimeout(() => this.say("Your active list was changed outside Circinus", "warn"), 400);
    this.refreshSteamClient();
  }

  private onTex(t: TexState) {
    const was = this.tex;
    this.tex = t;
    if (was?.running && !t.running && t.report) {
      const r = t.report;
      const kind = r.kind ?? (r.reverted || r.bytesFreed ? "revert" : "convert");
      if (kind === "revert") this.say(r.reverted ? `Removed ${r.reverted} DDS file${r.reverted === 1 ? "" : "s"} (${(r.bytesFreed / 1e6).toFixed(0)} MB)${r.cancelled ? ", then stopped" : ""}` : r.cancelled ? "Stopped before anything was removed" : "Nothing to remove: no DDS files of Circinus's were found", r.cancelled ? "warn" : "ok");
      else if (kind === "fix") this.say(`${r.fixed ?? 0} file${(r.fixed ?? 0) === 1 ? "" : "s"} rebuilt${r.failed ? `, ${r.failed} failed` : ""}`, r.failed ? "warn" : "ok");
      else if (kind === "convert") this.say(r.cancelled ? `Stopped after ${r.converted} textures` : `${r.converted} texture${r.converted === 1 ? "" : "s"} converted${r.failed ? `, ${r.failed} failed` : ""}${r.current ? `, ${r.current} already current` : ""} in ${r.seconds}s`, r.failed ? "warn" : "ok");
      this.refreshTextures();
    }
  }
  refreshTextures() {
    api.ddsState().then((t) => (this.tex = t)).catch(() => {});
    api.ddsOverview().then((o) => (this.texOverview = o)).catch((e) => console.warn("[circinus] dds_overview failed", e));
  }
  optimizeTextures(uids: string[]) {
    if (!uids.length) return;
    return this.run("Starting texture job…", async () => {
      await api.ddsStart(uids);
      this.tex = await api.ddsState();
      this.view = "textures";
    });
  }
  /** Check DDS files Circinus did not write for things Unity refuses. */
  auditTextures(uids: string[]) {
    if (!uids.length) return;
    return this.run("Checking DDS files…", async () => {
      const r = await api.ddsAudit(uids);
      this.audit = r;
      this.tex = await api.ddsState();
      this.say(r.files ? `${r.files} DDS file${r.files === 1 ? "" : "s"} the game will refuse in ${r.mods.length} mod${r.mods.length === 1 ? "" : "s"} · ${r.fixable} can be rebuilt` : `All DDS files in ${r.modsChecked} mods look loadable`, r.files ? "warn" : "ok");
      return r;
    });
  }
  /** Rebuild flagged files (all of a mod's when `rels` is empty), keeping the originals. */
  fixTextures(targets: [string, string[]][]) {
    if (!targets.length) return;
    return this.run("Rebuilding DDS files…", async () => {
      const r = await api.ddsFix(targets);
      this.tex = await api.ddsState();
      await this.refresh();
      this.refreshTextures();
      this.say(`${r.fixed ?? 0} file${(r.fixed ?? 0) === 1 ? "" : "s"} rebuilt${r.failed ? `, ${r.failed} failed` : ""} · originals kept as .circinus-orig`, r.failed ? "warn" : "ok");
      // Whatever was fixed no longer belongs in the findings.
      if (this.audit) {
        const uids = new Set(targets.map((t) => t[0]));
        const only = new Map(targets.map((t) => [t[0], t[1]]));
        this.audit = { ...this.audit, mods: this.audit.mods.map((m) => (!uids.has(m.uid) ? m : { ...m, findings: m.findings.filter((f) => !f.fixable || (only.get(m.uid)!.length > 0 && !only.get(m.uid)!.includes(f.rel))) })).filter((m) => m.findings.length), files: 0, fixable: 0 };
        this.audit.files = this.audit.mods.reduce((n, m) => n + m.findings.length, 0);
        this.audit.fixable = this.audit.mods.reduce((n, m) => n + m.findings.filter((f) => f.fixable).length, 0);
      }
      return r;
    });
  }
  /** Remove the DDS files Circinus made for these mods. Runs in the background: progress shows
   *  in the Textures view, the result arrives as a toast, and the list refreshes on its own. */
  revertTextures(uids: string[]) {
    if (!uids.length) return;
    return this.run("Starting removal…", async () => {
      await api.ddsRevert(uids);
      this.tex = await api.ddsState();
      this.view = "textures";
    });
  }
  cancelTextures() {
    api.ddsCancel().catch(() => {});
  }
  setDdsExcluded(uid: string, excluded: boolean) {
    return this.updateUser((u) => {
      const set = new Set(u.ddsExcluded ?? []);
      if (excluded) set.add(uid);
      else set.delete(uid);
      u.ddsExcluded = [...set];
      return u;
    });
  }

  // ---- the merged defs ----
  /** The report of the last flattening, when there is one. */
  defsReport = $derived(this.defs?.report ?? null);
  /** Origin index → the mod that origin belongs to, for names and colours. */
  defsOrigins = $derived(this.defsReport?.origins ?? []);
  defsModName = (origin: number) => this.defsOrigins[origin]?.name ?? "an unknown mod";

  async refreshDefs() {
    try {
      this.defs = await api.defsStatus();
      // A job that was started before this view was opened still needs watching.
      if (this.defs.running) this.watchDefs();
    } catch (e) {
      console.warn("[circinus] defs_status failed", e);
    }
  }
  /** Merge every active mod's defs. The work happens on a thread; this returns straight away. */
  startDefs() {
    return this.run("Merging defs…", async () => {
      this.defsTree = null;
      this.defsFound = [];
      this.defsQuery = null;
      this.defsError = null;
      await api.defsStart();
      this.defs = await api.defsStatus();
      this.view = "defs";
      this.watchDefs();
    });
  }
  stopDefs() {
    api.defsStop().catch(() => {});
  }
  /** In the app the progress event drives this; polling also covers the browser mock. */
  private defsTimer: ReturnType<typeof setInterval> | null = null;
  private watchDefs() {
    if (this.defsTimer) return;
    this.defsTimer = setInterval(async () => {
      let s: DefsState | null = null;
      try {
        s = await api.defsStatus();
      } catch {
        s = null;
      }
      if (s) this.onDefs(s);
      if (!s?.running && this.defsTimer) {
        clearInterval(this.defsTimer);
        this.defsTimer = null;
      }
    }, 400);
  }
  onDefs(s: DefsState) {
    const was = this.defs?.running ?? false;
    this.defs = s;
    if (!was || s.running) return;
    if (s.error) this.say(s.error, "err");
    else if (s.stopped) this.say("Stopped. Nothing was merged", "warn");
    else if (s.report) this.say(`${s.report.defs.toLocaleString()} defs merged · ${s.report.chains.length.toLocaleString()} contested values · ${(s.report.elapsedMs / 1000).toFixed(1)}s`);
  }
  /** Show one def's merged contents, optionally pointing at a path inside it. */
  openDef(defType: string, defName: string, path?: string) {
    this.defsFocus = path ?? null;
    return this.run("Reading the def…", async () => {
      this.defsTree = await api.defsDef(defType, defName);
      this.defsError = this.defsTree ? null : `Nothing called ${defName} is in the merged document`;
      return this.defsTree;
    });
  }
  /** Open the def an overwrite or a duplicate names (`ThingDef/Wall`). */
  openDefLabel(label: string, path?: string) {
    const at = label.indexOf("/");
    if (at < 0) return;
    return this.openDef(label.slice(0, at), label.slice(at + 1), path);
  }
  /** Defs whose defName contains `text`, case-insensitively: an xpath the backend already speaks. */
  async searchDefs(text: string) {
    const q = text.trim().replace(/['"\\]/g, "");
    if (!q) {
      this.defsFound = [];
      return;
    }
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const xpath = `Defs/*[contains(translate(defName,'${upper}','${upper.toLowerCase()}'),'${q.toLowerCase()}')]/defName`;
    try {
      const r = await api.defsQuery(xpath, 40);
      this.defsFound = r.matches;
      this.defsError = r.total ? null : `No def has ${q} in its name`;
    } catch (e) {
      this.defsFound = [];
      this.defsError = String(e);
    }
  }
  /** The advanced box: whatever xpath the user typed, run as RimWorld would run it. */
  async runDefsQuery(xpath: string) {
    try {
      this.defsQuery = await api.defsQuery(xpath, 200);
      this.defsError = null;
    } catch (e) {
      this.defsQuery = null;
      this.defsError = String(e);
    }
  }

  // ---- code patches ----
  /** A finished run leaves the report to be fetched; a stopped one keeps whatever it had. */
  private onPatchJob(j: PatchJob) {
    const was = this.patchJob;
    this.patchJob = j;
    if (was?.running && !j.running && !j.error) {
      const s = j.summary;
      if (s) this.say(j.cancelled ? `Stopped after ${s.assemblies} assemblies` : s.contested ? `${s.contested} method${s.contested === 1 ? " is" : "s are"} patched by more than one mod, out of ${s.targets.toLocaleString()} patched in all` : `${s.targets.toLocaleString()} patched methods, none contested`, j.cancelled || s.contested ? "warn" : "ok");
      this.loadPatchReport();
    }
  }
  /** Ask what the last run found. Safe to call more than once. */
  async refreshPatches() {
    api.patchesStatus().then((j) => (this.patchJob = j)).catch(() => {});
    if (!this.patchReport) await this.loadPatchReport();
  }
  private async loadPatchReport() {
    try {
      this.patchReport = await api.patchesReport();
    } catch (e) {
      console.warn("[circinus] patches_report failed", e);
    }
  }
  scanPatches() {
    return this.run("Reading assemblies…", async () => {
      await api.patchesStart();
      this.patchJob = await api.patchesStatus();
      this.view = "patches";
    });
  }
  stopPatches() {
    api.patchesStop().catch(() => {});
  }
  /** One mod's methods, for a row that expands. */
  patchesForMod(uid: string) {
    return api.patchesForMod(uid).catch((e): ModPatchDetail | null => {
      console.warn("[circinus] patches_for_mod failed", e);
      return null;
    });
  }
  /** The contested methods a mod takes part in, worst first, straight from the loaded report. */
  contestedFor(uid: string) {
    return (this.patchReport?.targets ?? []).filter((t) => t.contested && t.patchers.some((p) => p.uid === uid));
  }
  patchesOf(uid: string) {
    return this.patchReport?.perMod.find((m) => m.uid === uid);
  }

  refreshDownloads() {
    api.downloadsState()
      .then((q) => { this.downloads = q; this.downloadsError = null; })
      .catch((e) => { this.downloadsError = String(e); console.warn("[circinus] downloads_state failed", e); });
    api.steamcmdStatus().then((st) => (this.steamcmd = st)).catch(() => {});
  }

  async refresh() {
    const had = this.snap != null && this.snap.scannedAt > 0;
    const before = new Set(this.changes.map((c) => `${c.kind}:${c.uid}`));
    const beforeList = JSON.stringify(this.listChange);
    const next = await api.snapshot();
    if (!this.accept(next)) return;
    this.snap = next;
    api.ddsOverview().then((o) => (this.texOverview = o)).catch(() => {});
    if (this.loading && this.snap.scannedAt) {
      // The first scan came in while the overlay was waiting for it.
      this.loading = false;
      this.announceChanges(this.snap);
      this.refreshTextures();
      return;
    }
    if (!had) return;
    // Something changed while we were open (Steam updated a mod, the game rewrote the list).
    const fresh = this.changes.filter((c) => !before.has(`${c.kind}:${c.uid}`));
    if (fresh.length) {
      const first = fresh[0];
      const what = first.kind === "updated" && first.reasons.includes("workshopUpdate") ? `Steam updated ${first.name}` : first.kind === "added" ? `${first.name} was installed` : first.kind === "removed" ? `${first.name} was removed` : `${first.name} changed on disk`;
      this.say(fresh.length === 1 ? what : `${what} and ${fresh.length - 1} more changed`, "warn");
    } else if (this.listChange && JSON.stringify(this.listChange) !== beforeList) {
      this.say("ModsConfig.xml was changed outside Circinus", "warn");
    }
  }

  /** Open a folder in the file manager — the folder itself, not the one holding it.
   *
   *  Every "Open folder" in the app used `revealItemInDir`, which opens a thing's *parent* and
   *  selects it. That is the right gesture for a file and the wrong one for a folder: asked to
   *  open a mod's folder it opened the Mods folder with the mod highlighted, one level above the
   *  thing that was asked for, and in a folder of five hundred mods that is not a small
   *  difference. Reveal is still what a file gets (a log, an executable), where seeing it among
   *  its neighbours is the point.
   *
   *  One method rather than four call sites because the folder can be gone — a mod unsubscribed,
   *  a drive unplugged — and a button that does nothing at all when pressed is worse than one
   *  that says why. */
  async openFolder(path: string) {
    try {
      await openFolder(path);
    } catch (e) {
      // Say what actually went wrong, not what probably did. The first version of this guessed
      // "it may have been moved or removed" for every failure, and the failure it was actually
      // catching was a permission scope refusing every path -- so it sent people to look at a
      // folder that was sitting right where they left it.
      this.say(String(e), "err");
    }
  }

  say(msg: string, kind: "ok" | "warn" | "err" = "ok") {
    this.toast = { msg, kind };
    setTimeout(() => {
      if (this.toast?.msg === msg) this.toast = null;
    }, kind === "err" ? 8000 : 3500);
  }

  private async run<T>(label: string, f: () => Promise<T>): Promise<T | undefined> {
    this.busy = label;
    try {
      return await f();
    } catch (e) {
      this.say(String(e), "err");
      return undefined;
    } finally {
      this.busy = null;
    }
  }

  /** Take a snapshot, or refuse it and say so.
   *
   *  A snapshot the store cannot read does not fail where it arrives -- it fails later, inside
   *  whichever `$derived` touches it first, and Svelte caches that throw and hands it to every
   *  reader afterwards. The window then goes down with an error from deep inside the framework
   *  rather than the one that mattered. Reading the few fields everything depends on, here, turns
   *  that into a message naming the real problem, with the previous snapshot still on screen. */
  private accept(s: Snapshot): boolean {
    try {
      void s.mods.length;
      void s.active.length;
      void s.settings.listColumns;
      void s.gameVersion.majorMinor;
      void s.user.groups;
      return true;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.error("[circinus] unusable snapshot", e);
      api.logFromTheWindow(`unusable snapshot: ${why}`, e instanceof Error ? e.stack : undefined).catch(() => {});
      // With something already on screen, keep it and say so in passing: what is there is still
      // true, it is only out of date. With nothing, an empty window pretending to be a mod
      // manager with no mods is worse than a sentence explaining itself.
      if (this.snap) this.say(`Circinus could not read what the backend sent back: ${why}. What you can see is the last good copy; Settings has Copy diagnostics.`, "err");
      else this.error = `Circinus could not read what the backend sent back: ${why}\n\nNothing on disk has been changed. Settings has Copy diagnostics for a bug report.`;
      return false;
    }
  }

  private apply(s: Snapshot | undefined) {
    if (s && this.accept(s)) {
      this.snap = s;
      this.clearPreview();
    }
  }

  // ---- selection ----
  select(uid: string, opts: { toggle?: boolean; range?: boolean; list?: string[] } = {}) {
    if (opts.range && this.selected.length && opts.list) {
      const anchor = this.selected[0];
      const a = opts.list.indexOf(anchor), b = opts.list.indexOf(uid);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.selected = [anchor, ...opts.list.slice(lo, hi + 1).filter((u) => u !== anchor)];
        return;
      }
    }
    if (opts.toggle) {
      this.selected = this.selected.includes(uid) ? this.selected.filter((u) => u !== uid) : [...this.selected, uid];
      return;
    }
    this.selected = [uid];
  }

  // ---- actions ----
  rescan(full = false) {
    return this.run(full ? "Re-reading every mod…" : "Refreshing…", async () => this.apply(await api.rescan(full)));
  }
  setActive(uids: string[]) {
    return this.run("Reordering…", async () => this.apply(await api.setActive(uids)));
  }
  activate(uids: string[], at?: number) {
    return this.run("Activating…", async () => this.apply(await api.activate(uids, at)));
  }
  deactivate(uids: string[]) {
    return this.run("Deactivating…", async () => {
      this.apply(await api.deactivate(uids));
      this.selected = this.selected.filter((u) => !uids.includes(u));
    });
  }
  moveSelected(delta: number) {
    const sel = this.selected.filter((u) => this.activeSet.has(u));
    if (!sel.length) return;
    const order = [...this.active];
    const idxs = sel.map((u) => order.indexOf(u)).sort((a, b) => a - b);
    if (delta < 0 && idxs[0] === 0) return;
    if (delta > 0 && idxs[idxs.length - 1] === order.length - 1) return;
    const seq = delta < 0 ? idxs : [...idxs].reverse();
    for (const i of seq) {
      const j = i + delta;
      [order[i], order[j]] = [order[j], order[i]];
    }
    return this.setActive(order);
  }
  moveTo(uids: string[], index: number) {
    const rest = this.active.filter((u) => !uids.includes(u));
    const before = this.active.slice(0, index).filter((u) => !uids.includes(u)).length;
    const order = [...rest.slice(0, before), ...uids, ...rest.slice(before)];
    return this.setActive(order);
  }
  haloPreview() {
    return this.run("Computing HALO order…", async () => {
      this.preview = await api.halo(false);
      const n = this.preview.moves.length;
      this.say(n ? `HALO would move ${n} mod${n === 1 ? "" : "s"}. Check the arrows, then apply` : "Already in HALO order");
    });
  }
  haloApply() {
    return this.run("Applying HALO order…", async () => {
      const r = await api.halo(true);
      this.snap = await api.snapshot();
      this.clearPreview();
      this.say(r.moves.length ? `Moved ${r.moves.length} mod${r.moves.length === 1 ? "" : "s"}` : "Already in HALO order");
    });
  }
  save() {
    return this.run("Saving…", async () => {
      const p = await api.save();
      this.snap = await api.snapshot();
      this.say(`Saved ModsConfig.xml`);
      return p;
    });
  }
  async importFrom(path?: string, text?: string) {
    return this.run("Reading list…", async () => {
      this.importPreview = await api.importList(path, text);
    });
  }
  /** Which pane holds a mod, so a scroll request reaches the list that can actually show it. */
  paneFor(uid: string): Pane | null {
    if (this.splitMode === "library") return this.activeSet.has(uid) ? "active" : "inactive";
    return null;
  }
  /** Bring a mod into view, in whichever pane can show it. */
  scrollTo(uid: string, opts: { pane?: Pane | null; select?: boolean; focus?: boolean } = {}) {
    // The what-changes board is not a list, so a mod cannot be scrolled to inside it: leave it.
    if (opts.pane === undefined && this.split === "halo") this.split = null;
    if (opts.select !== false) this.select(uid);
    this.scrollRequest = { uid, pane: opts.pane !== undefined ? opts.pane : this.paneFor(uid), focus: opts.focus !== false };
  }
  /** Leaving a preview behind, applied or discarded: the comparison has nothing left to compare. */
  clearPreview() {
    this.preview = null;
    if (this.split === "halo") this.split = null;
  }
  /** Bring a mod into view wherever it is: the load order view, the tab it lives in, and any
   *  filter that would hide it lifted. */
  reveal(uid: string) {
    const m = this.byUid.get(uid);
    if (!m) return;
    this.view = "order";
    const inactive = !this.activeSet.has(uid);
    // The what-changes board is not a list, so revealing a row has to leave it behind.
    if (this.split === "halo") this.split = null;
    if (inactive && this.tab === "active") this.tab = "inactive";
    if (!inactive && this.tab === "inactive") this.tab = "active";
    // Lift only the filters that hide it, one at a time.
    const lifts: (() => void)[] = [() => (this.query = ""), () => (this.group = null), () => (this.showOnly = null), () => (this.onlyCurrentVersion = false), () => (this.sources = [...ALL_SOURCES])];
    for (const lift of lifts) {
      if (this.matches(m)) break;
      lift();
    }
    this.scrollTo(uid);
  }
  /** Mods with something to look at, in the order to look at them: errors first, then warnings,
   *  then notes; within that, list order, with inactive mods last. */
  reviewList = $derived.by((): string[] => {
    const rank: Record<Severity, number> = { error: 0, warning: 1, note: 2 };
    const key = new Map<string, [number, number, number]>();
    for (const [uid, list] of this.issuesByUid) {
      if (!this.byUid.has(uid)) continue;
      const sev = Math.min(...list.map((i) => rank[severityOf(i)]));
      key.set(uid, [this.activeSet.has(uid) ? 0 : 1, sev, this.indexOf.get(uid) ?? Number.MAX_SAFE_INTEGER]);
    }
    return [...key.entries()].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[1][2] - b[1][2] || (this.byUid.get(a[0])?.name ?? "").localeCompare(this.byUid.get(b[0])?.name ?? "")).map(([u]) => u);
  });
  /** Where Review stands: the selected mod's place in the review list (or -1) and the total. */
  reviewPos = $derived.by(() => {
    const list = this.reviewList;
    const at = this.selected.length === 1 ? list.indexOf(this.selected[0]) : -1;
    return { at, total: list.length };
  });
  /** Go to the next thing to review, after whatever is selected; the first one otherwise. */
  reviewNext() {
    this.reviewStep(1);
  }
  /** And back. Walking a list one way only is half a review: overshoot the mod you wanted and
   *  the only way back was round the whole list. */
  reviewPrev() {
    this.reviewStep(-1);
  }
  private reviewStep(by: 1 | -1) {
    const list = this.reviewList;
    if (!list.length) return;
    const { at } = this.reviewPos;
    // -1 (nothing selected) steps to the first going forward and the last going back, which is
    // what "the next thing to look at" means from outside the list in either direction.
    this.reveal(list[(at + by + list.length) % list.length]);
  }

  /** Every row on screen in the list that has the keyboard, in the order it is drawn.
   *
   *  Registered by `ModList` because only it knows what its virtualiser has laid out, and read
   *  by anything that has to act on "the list" without being it -- select-all, most obviously.
   *  A function rather than an array so it is never a stale copy. */
  visibleListFn: (() => string[]) | null = null;
  visibleList(): string[] {
    return this.visibleListFn?.() ?? this.visibleActive.map((m) => m.uid);
  }
  // ---- downloads ----
  async queueText(text: string) {
    return this.run("Looking up on Steam…", async () => {
      const r = await api.downloadsAddText(text);
      this.downloads = await api.downloadsState();
      this.say(`${r.added} queued${r.skipped.length ? ` · ${r.skipped.length} skipped: ${r.skipped.map(([id, why]) => `${id} (${why})`).join(", ")}` : ""}`, r.skipped.length ? "warn" : "ok");
      return r;
    });
  }
  async queueIds(ids: number[]) {
    if (!ids.length) return;
    return this.run("Looking up on Steam…", async () => {
      const r = await api.downloadsAdd(ids);
      this.downloads = await api.downloadsState();
      this.say(`${r.added} queued${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`);
      return r;
    });
  }
  /** Force update: a Steam mod is replaced in Steam's folder, a copy Circinus made in Mods.
   *  The backend refuses anything else, and the reasons are shown rather than just counted. */
  async updateMods(uids: string[]) {
    if (!uids.length) return;
    return this.run("Looking up on Steam…", async () => {
      const r = await api.downloadsUpdate(uids);
      this.downloads = await api.downloadsState();
      this.say(`${r.added} queued${r.skipped.length ? ` · ${r.skipped.length} skipped: ${r.skipped.map(([, why]) => why).join("; ")}` : ""}`, r.skipped.length ? "warn" : "ok");
      return r;
    });
  }
  async queueMissing() {
    return this.run("Resolving missing mods…", async () => {
      const [r, unresolved] = await api.downloadsAddMissing();
      this.downloads = await api.downloadsState();
      this.say(`${r.added} queued${unresolved.length ? ` · ${unresolved.length} not in the Steam database: ${unresolved.slice(0, 5).join(", ")}${unresolved.length > 5 ? "…" : ""}` : ""}`, unresolved.length ? "warn" : "ok");
    });
  }
  async removeDownloads(ids: number[]) {
    this.downloads = await api.downloadsRemove(ids);
  }
  async retryFailed() {
    const n = await api.downloadsRetryFailed();
    this.downloads = await api.downloadsState();
    this.say(`${n} retried`);
  }
  async clearFinished() {
    this.downloads = await api.downloadsClearFinished();
  }
  async pauseDownloads(paused: boolean) {
    this.downloads = await api.downloadsPause(paused);
  }
  installSteamCmd() {
    // Show the Downloads view first so the install log streams into view.
    this.view = "downloads";
    return this.run("Installing SteamCMD…", async () => {
      await api.steamcmdInstall();
      this.downloads = await api.downloadsState();
      this.steamcmd = await api.steamcmdStatus();
      this.say("SteamCMD is ready");
    });
  }
  // ---- subscriptions, through the Steam client ----
  refreshSteamClient() {
    api.steamClientStatus().then((s) => (this.steamClient = s)).catch((e) => console.warn("[circinus] steam_client_status:", e));
  }
  /** Remember what Steam says about these ids, so the UI can stop offering what is already done. */
  async readSubscriptions(ids: number[]) {
    if (!ids.length) return;
    try {
      const states = await api.subscriptionState(ids);
      const next = { ...this.subscriptions };
      for (const s of states) next[s.id] = s.state;
      this.subscriptions = next;
    } catch (e) {
      console.warn("[circinus] subscription_state:", e);
    }
  }
  /** What the outcome of a subscribe or unsubscribe request means, said as it is — in one
   * sentence, because a second toast would replace the first before it could be read. */
  private reportSubscribe(r: SubscribeOutcome, extra?: string) {
    for (const s of r.states) this.subscriptions[s.id] = s.state;
    const parts = [r.note];
    if (r.skipped.length) parts.push(`${r.skipped.length} left alone: ${r.skipped.slice(0, 2).map(([id, why]) => `${id} — ${why}`).join("; ")}`);
    if (r.failed.length) parts.push(`${r.failed.length} could not be opened`);
    if (extra) parts.push(extra);
    this.say(parts.join(" · "), r.failed.length ? "err" : r.opened.length ? "ok" : "warn");
    this.steamClient = r.client;
  }
  /** Open the Steam page for each id so the user can subscribe. Steam, not Circinus, decides. */
  async subscribeIds(ids: number[]) {
    if (!ids.length) return;
    return this.run("Asking Steam…", async () => {
      const r = await api.subscribeItems(ids);
      this.reportSubscribe(r);
      return r;
    });
  }
  /** The same page, to unsubscribe. Steam deletes the folder; the caller confirms first. */
  async unsubscribeIds(ids: number[]) {
    if (!ids.length) return;
    return this.run("Asking Steam…", async () => {
      const r = await api.unsubscribeItems(ids);
      this.reportSubscribe(r);
      return r;
    });
  }
  /** Subscribe to everything in the list that is not installed and has a Workshop id. */
  async subscribeMissing() {
    return this.run("Resolving missing mods…", async () => {
      const [ids, unresolved] = await api.missingWorkshopIds();
      if (!ids.length) {
        this.say(unresolved.length ? `No Workshop id is known for ${unresolved.length === 1 ? "that mod" : "those mods"}: ${unresolved.slice(0, 3).join(", ")}` : "Nothing is missing", "warn");
        return;
      }
      const r = await api.subscribeItems(ids);
      this.reportSubscribe(r, unresolved.length ? `${unresolved.length} more ${unresolved.length === 1 ? "is" : "are"} not in the Steam database: ${unresolved.slice(0, 3).join(", ")}` : undefined);
      return r;
    });
  }
  /** Steam's record caught up with what the user pressed. */
  private onSubscription(p: SubscriptionProgress) {
    const next = { ...this.subscriptions };
    for (const s of p.states) next[s.id] = s.state;
    this.subscriptions = next;
    if (!p.settled) return;
    const n = p.states.length;
    this.say(p.want === "subscribe" ? `Steam has ${n === 1 ? "the mod" : `all ${n} mods`}. Rescanning` : `Steam removed ${n === 1 ? "the mod" : `${n} mods`}. Rescanning`);
  }

  testSteamCmd() {
    return this.run("Testing SteamCMD…", async () => {
      const t = await api.steamcmdTest();
      this.downloads = await api.downloadsState();
      this.say(t.loggedIn ? `SteamCMD works: anonymous login in ${t.seconds}s` : t.stalled ? "SteamCMD produced no output. See the log" : `SteamCMD finished without confirming a login (exit ${t.exitCode ?? "?"})`, t.loggedIn ? "ok" : "err");
      return t;
    });
  }
  acknowledgeChanges() {
    return this.run("Clearing…", async () => {
      this.apply(await api.acknowledgeChanges());
      this.showChanges = false;
    });
  }
  /** Stop marking the new mods. Leaves the New tab in place with the arrival dates still on it,
   *  because "I have seen these" and "I no longer want to know when they came" are not the same
   *  thing, and the second is not what anyone means by clicking it. */
  /** How many "these two do not work together" warnings are hidden. */
  hiddenWarnings = $derived((this.snap?.user.muted ?? []).length);
  /** Hide this pair's warning, or bring it back. */
  setIncompatibilityHidden(uid: string, otherUid: string, hidden: boolean) {
    return this.run(hidden ? "Hiding it…" : "Bringing it back…", async () => {
      this.apply(await api.setIncompatibilityHidden(uid, otherUid, hidden));
      this.say(hidden ? "Hidden. Settings brings every hidden warning back." : "That warning is back.");
    });
  }
  clearHiddenWarnings() {
    return this.run("Bringing them back…", async () => {
      const [n, snap] = await api.clearHiddenWarnings();
      this.apply(snap);
      this.say(n ? `${n} hidden ${n === 1 ? "warning is" : "warnings are"} showing again` : "There were none hidden");
    });
  }
  markNewSeen() {
    return this.run("Clearing…", async () => {
      this.apply(await api.markNewSeen());
      if (this.tab === "new") this.tab = "all";
    });
  }
  /** Put an archived list back; with `save`, write it to ModsConfig.xml straight away. */
  restoreList(path: string, save: boolean) {
    return this.run(save ? "Restoring and saving…" : "Restoring…", async () => {
      const r = await api.restoreList(path, save);
      this.snap = r.snapshot;
      this.clearPreview();
      this.showImport = false;
      this.say(`${r.restored} mods back in the list${r.missing.length ? `, ${r.missing.length} not installed` : ""}${save ? " · ModsConfig.xml saved" : " · press Save to write it"}`, r.missing.length ? "warn" : "ok");
      return r;
    });
  }
  // ---- named lists ----
  namedLists = $derived(this.snap?.namedLists ?? []);
  currentList = $derived(this.snap?.currentList ?? null);
  saveNamedList(name: string) {
    return this.run("Saving list…", async () => {
      this.apply(await api.saveNamedList(name));
      this.say(`List ${name.trim()} saved (${this.active.length} mods)`);
    });
  }
  loadNamedList(name: string) {
    return this.run("Loading list…", async () => {
      const r = await api.loadNamedList(name);
      this.snap = r.snapshot;
      this.clearPreview();
      this.say(`${r.restored} mods in the list${r.missing.length ? `, ${r.missing.length} not installed` : ""} · press Save to write ModsConfig.xml`, r.missing.length ? "warn" : "ok");
      return r;
    });
  }
  deleteNamedList(name: string) {
    return this.run("Deleting list…", async () => {
      this.apply(await api.deleteNamedList(name));
      this.say(`List ${name} deleted`);
    });
  }
  renameNamedList(from: string, to: string) {
    return this.run("Renaming list…", async () => this.apply(await api.renameNamedList(from, to)));
  }
  detachList() {
    return this.run("…", async () => this.apply(await api.detachList()));
  }

  // ---- instances ----
  /** Every instance, newest last; refreshed whenever one changes. */
  instances = $state<Instance[]>([]);
  /** The one that is open, as the last snapshot saw it. */
  instance = $derived(this.snap?.instance ?? null);
  async refreshInstances() {
    try {
      this.instances = await api.instances();
    } catch (e) {
      console.warn("[circinus] instances_list failed", e);
    }
  }
  /** Open another instance: other folders, other lists, a fresh scan. `discard` drops unsaved
   *  changes to the current list, which the backend otherwise refuses to lose. */
  switchInstance(id: string, discard = false) {
    if (id === this.instance?.id) return;
    return this.run("Switching instance…", async () => {
      const inst = await api.instanceSwitch(id, discard);
      const fresh = await api.snapshot();
      if (this.accept(fresh)) this.snap = fresh;
      this.selected = [];
      this.clearPreview();
      await this.refreshInstances();
      this.say(`${inst.name}: reading its mods`);
      return inst;
    });
  }
  createInstance(name: string, fromCurrent: boolean) {
    return this.run("Making the instance…", async () => {
      const inst = await api.instanceCreate(name, fromCurrent);
      await this.refreshInstances();
      this.say(`Instance ${inst.name} made${fromCurrent ? " from the folders you have open" : ""}`);
      return inst;
    });
  }
  duplicateInstance(id: string) {
    return this.run("Copying the instance…", async () => {
      const inst = await api.instanceDuplicate(id);
      await this.refreshInstances();
      this.say(`Instance ${inst.name} made; it points at the same folders`);
      return inst;
    });
  }
  renameInstance(id: string, name: string) {
    return this.run("Renaming…", async () => {
      await api.instanceRename(id, name);
      await this.refreshInstances();
      if (id === this.instance?.id) this.snap = await api.snapshot();
    });
  }
  /** Change one instance's folders and launch settings. */
  updateInstance(id: string, locations: Locations, launch: LaunchSettings) {
    return this.run("Saving the instance…", async () => {
      await api.instanceUpdate(id, locations, launch);
      await this.refreshInstances();
      this.snap = await api.snapshot();
      if (id === this.instance?.id) await this.rescan(false);
    });
  }
  /** Forget an instance. Nothing of the game's is deleted. */
  deleteInstance(id: string) {
    return this.run("Forgetting the instance…", async () => {
      const what = await api.instanceDelete(id);
      await this.refreshInstances();
      this.snap = await api.snapshot();
      this.say(what);
    });
  }

  // ---- collections ----
  collections = $derived(this.snap?.user.collections ?? []);
  /** Installed mods by Workshop id, for matching collections and downloads. */
  byPfid = $derived(new Map(this.mods.filter((m) => m.publishedFileId && !m.invalid).map((m) => [m.publishedFileId!, m])));
  /** What a followed collection looks like against the install. */
  collectionView(c: TrackedCollection) {
    const installed = c.items.filter((id) => this.byPfid.has(id));
    const missing = c.items.filter((id) => !this.byPfid.has(id));
    const added = c.items.filter((id) => !c.known.includes(id));
    const removed = c.known.filter((id) => !c.items.includes(id));
    const active = installed.filter((id) => this.activeSet.has(this.byPfid.get(id)!.uid));
    return { installed, missing, added, removed, active };
  }
  // ---- what a curator said ----
  //
  // A collection says what changed. It cannot say why, or that a save needs a mod removed before
  // it will load. Curators say that on Discord, and a player who follows the pack here and not
  // there never hears it. The feed comes from circinus.sh; the app has no idea Discord exists.
  announcements = $derived(this.snap?.announcements ?? []);
  /** Per pack: how far down the user has read. */
  packsRead = $derived(this.snap?.user.packsRead ?? {});
  packsMuted = $derived(new Set(this.snap?.user.packsMuted ?? []));
  /** The posts newer than the mark on their pack. What the banner counts. */
  unreadAnnouncements = $derived(this.announcements.filter((a) => a.at > (this.packsRead[String(a.pack)] ?? 0)));
  packName(id: number) {
    return this.collections.find((c) => c.id === id)?.name ?? String(id);
  }
  refreshAnnouncements() {
    return this.run("Asking circinus.sh…", async () => this.apply(await api.announcementsRefresh()));
  }
  /** Mark one pack read up to its newest post. */
  readAnnouncements(pack: number) {
    const newest = this.announcements.filter((a) => a.pack === pack).reduce((n, a) => Math.max(n, a.at), 0);
    if (!newest) return;
    return this.run("…", async () => this.apply(await api.announcementsSeen(pack, newest)));
  }
  /** Mark every pack read, which is what closing the panel means. */
  readAllAnnouncements() {
    const packs = [...new Set(this.unreadAnnouncements.map((a) => a.pack))];
    if (!packs.length) return;
    return this.run("…", async () => {
      for (const p of packs) {
        const newest = this.announcements.filter((a) => a.pack === p).reduce((n, a) => Math.max(n, a.at), 0);
        this.apply(await api.announcementsSeen(p, newest));
      }
    });
  }
  mutePack(pack: number, muted: boolean) {
    return this.run("…", async () => {
      this.apply(await api.announcementsMute(pack, muted));
      this.say(muted ? t("packs.muted", { name: this.packName(pack) }) : t("packs.unmuted", { name: this.packName(pack) }));
    });
  }

  trackCollection(text: string) {
    return this.run("Asking Steam about the collection…", async () => {
      this.apply(await api.collectionTrack(text));
      const c = this.collections[this.collections.length - 1];
      if (c) this.say(`Following ${c.name}: ${c.items.length} mods`);
    });
  }
  refreshCollections(id?: number) {
    return this.run("Asking Steam…", async () => {
      this.apply(await api.collectionRefresh(id));
      const changed = this.collections.filter((c) => (id == null || c.id === id) && (this.collectionView(c).added.length || this.collectionView(c).removed.length));
      this.say(changed.length ? `${changed.length} collection${changed.length === 1 ? " has" : "s have"} changed` : "No changes in your collections");
    });
  }
  acknowledgeCollection(id: number) {
    return this.run("…", async () => this.apply(await api.collectionAcknowledge(id)));
  }
  untrackCollection(id: number) {
    return this.run("…", async () => {
      this.apply(await api.collectionUntrack(id));
      if (this.showCollection === id) this.showCollection = null;
    });
  }
  /** Activate the installed mods of a collection, in the collection's order, after what is active now. */
  activateCollection(c: TrackedCollection) {
    const uids = c.items.map((id) => this.byPfid.get(id)?.uid).filter((u): u is string => !!u && !this.activeSet.has(u));
    if (!uids.length) return this.say("Everything installed from it is already active");
    return this.activate(uids);
  }
  /** Make a named list from a collection: its installed mods in its order, after the game and DLC. */
  listFromCollection(c: TrackedCollection) {
    const official = this.active.filter((u) => this.byUid.get(u)?.source === "ludeon");
    const uids = c.items.map((id) => this.byPfid.get(id)?.uid).filter((u): u is string => !!u && !official.includes(u));
    return this.run("Making a list…", async () => {
      this.apply(await api.setActive([...official, ...uids]));
      this.apply(await api.saveNamedList(c.name));
      this.say(`List ${c.name} made from the collection: ${uids.length} mods, ${c.items.length - uids.length} not installed`);
    });
  }

  // ---- the mod itself ----
  /** Keep your own copy of a Workshop mod in the Mods folder, and load that one. */
  localizeMod(uid: string) {
    const m = this.byUid.get(uid);
    return this.run("Copying…", async () => {
      const [snap, what] = await api.localizeMod(uid);
      this.apply(snap);
      this.say(`${m?.name ?? uid}: ${what}`);
    });
  }
  deleteMod(uid: string) {
    const m = this.byUid.get(uid);
    return this.run("Deleting…", async () => {
      const [snap, what] = await api.deleteMod(uid);
      this.apply(snap);
      this.selected = this.selected.filter((u) => u !== uid);
      this.say(`${m?.name ?? uid}: ${what}`);
    });
  }

  /** Which Player.log files exist right now. */
  async refreshGameLogFiles() {
    try {
      this.gameLogFiles = await api.playerLogPaths();
    } catch (e) {
      console.warn("[circinus] player log paths:", e);
    }
  }
  /** Parse a Player.log (the current one by default) and tie it to the installed mods. */
  analyzeGameLog(path?: string) {
    return this.run("Reading the game log…", async () => {
      const a = await api.analyzePlayerLog(path);
      this.gameLog = a;
      await this.refreshGameLogFiles();
      const r = a.report;
      this.say(r.outcome === "crashed" ? "The game crashed. See what led up to it" : r.outcome === "loadFailedReset" ? "RimWorld failed to load and reset the list" : `Read ${r.lines.toLocaleString()} lines · ${r.exceptions.length} exception group${r.exceptions.length === 1 ? "" : "s"}`, r.outcome === "ok" ? "ok" : "warn");
      return a;
    });
  }
  /** Play: through Steam or the executable, per Settings; saves first when asked to. */
  launch() {
    return this.run("Starting RimWorld…", async () => {
      const msg = await api.launchGame();
      if (this.snap?.dirty) await this.refresh();
      this.say(msg);
    });
  }
  dismiss(id: string) {
    if (!this.dismissed.includes(id)) this.dismissed = [...this.dismissed, id];
  }
  checkUpdates() {
    return this.run("Asking the Workshop…", async () => {
      const n = await api.checkUpdates();
      await this.refresh();
      this.say(n ? `${n} mod${n === 1 ? " has" : "s have"} a newer Workshop version` : "Everything is current");
    });
  }
  importCollection(text: string) {
    return this.run("Expanding collection…", async () => {
      this.collectionPreview = await api.importCollection(text);
      this.rentryPreview = null;
      this.importPreview = null;
    });
  }
  importRentry(url: string) {
    return this.run("Fetching Rentry…", async () => {
      const r = await api.importRentry(url);
      this.rentryPreview = r;
      this.importPreview = r.preview;
      this.collectionPreview = null;
    });
  }
  applyCollection(append: boolean) {
    const p = this.collectionPreview;
    if (!p) return;
    return this.run("Applying collection…", async () => {
      const uids = p.installed.map(([, uid]) => uid);
      this.apply(await api.applyImport(uids, append));
      this.say(`${append ? "Appended" : "Activated"} ${uids.length} installed mods${p.missing.length ? `, ${p.missing.length} not installed` : ""}`);
    });
  }
  applyImport(append: boolean) {
    const p = this.importPreview;
    if (!p) return;
    return this.run("Applying list…", async () => {
      this.apply(await api.applyImport(p.uids, append));
      this.importPreview = null;
      this.showImport = false;
      this.say(`${append ? "Appended" : "Imported"} ${p.uids.length} mods${p.missing.length ? `, ${p.missing.length} not installed` : ""}`, p.missing.length ? "warn" : "ok");
    });
  }
  updateUser(patch: (u: UserData) => UserData) {
    if (!this.snap) return;
    const next = patch(structuredClone($state.snapshot(this.snap.user)));
    return this.run("Saving…", async () => this.apply(await api.updateUser(next)));
  }
  setGroup(uids: string[], groupId: string | null) {
    return this.updateUser((u) => {
      for (const uid of uids) {
        if (groupId) u.modGroups[uid] = groupId;
        else delete u.modGroups[uid];
      }
      return u;
    });
  }
  /** Make a group, with members if given (one save, so nothing is lost between two). Returns its id. */
  addGroup(name: string, opts: { members?: string[]; color?: string } = {}): string {
    const clean = name.trim();
    const id = (clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group") + "-" + Math.random().toString(36).slice(2, 6);
    const n = this.snap?.user.groups.length ?? 0;
    this.updateUser((u) => {
      for (const uid of opts.members ?? []) u.modGroups[uid] = id;
      return { ...u, groups: [...u.groups, { id, name: clean, color: opts.color ?? GROUP_COLORS[n % GROUP_COLORS.length] }] };
    });
    return id;
  }
  /** A group that holds its own band in the load order, made in one update.
   *
   *  `addGroup` then `updateGroup` reads the user back between the two, and the second call
   *  starts from a copy that does not have the new group in it, so the band silently never got
   *  its section. Anything that has to set a group's fields at birth belongs here instead. */
  addBand(name: string, after: Phase): string {
    const clean = name.trim();
    const id = (clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "band") + "-" + Math.random().toString(36).slice(2, 6);
    const n = this.snap?.user.groups.length ?? 0;
    this.updateUser((u) => ({ ...u, groups: [...u.groups, { id, name: clean, color: GROUP_COLORS[n % GROUP_COLORS.length], section: true, phase: after }] }));
    return id;
  }
  updateGroup(id: string, patch: Partial<Omit<Group, "id">>) {
    return this.updateUser((u) => ({ ...u, groups: u.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
  }
  /** Remove a group; its members keep their places, they just lose the label. */
  deleteGroup(id: string) {
    if (this.group === id) this.group = null;
    return this.updateUser((u) => {
      for (const [uid, g] of Object.entries(u.modGroups)) if (g === id) delete u.modGroups[uid];
      return { ...u, groups: u.groups.filter((g) => g.id !== id) };
    });
  }
  /** Move a group up or down the list; for groups with their own section this is also the
   *  order they follow one another in the load order. */
  moveGroup(id: string, dir: -1 | 1) {
    return this.updateUser((u) => {
      const i = u.groups.findIndex((g) => g.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= u.groups.length) return u;
      const groups = [...u.groups];
      [groups[i], groups[j]] = [groups[j], groups[i]];
      return { ...u, groups };
    });
  }
  /** What "Sort it as" shows for a mod: an explicit phase, its group's own section, or HALO's choice. */
  sortAsOf(uid: string): string {
    const p = this.snap?.user.phaseOverrides[uid];
    if (p) return p;
    const g = this.groupOf(uid);
    return g?.section && g.phase ? `group:${g.id}` : "";
  }
  /** Apply a "Sort it as" choice: a phase, a group's section (which puts the mod in that group), or nothing. */
  setSortAs(uids: string[], value: string) {
    if (value.startsWith("group:")) {
      const gid = value.slice(6);
      return this.updateUser((u) => {
        for (const uid of uids) {
          u.modGroups[uid] = gid;
          delete u.phaseOverrides[uid];
        }
        return u;
      });
    }
    return this.updateUser((u) => {
      for (const uid of uids) {
        if (value) u.phaseOverrides[uid] = value as Phase;
        else delete u.phaseOverrides[uid];
      }
      return u;
    });
  }
  setPinned(uids: string[], pinned: boolean) {
    return this.updateUser((u) => {
      const set = new Set(u.pinned);
      for (const uid of uids) pinned ? set.add(uid) : set.delete(uid);
      u.pinned = [...set];
      return u;
    });
  }
  togglePin(uid: string) {
    return this.updateUser((u) => {
      u.pinned = u.pinned.includes(uid) ? u.pinned.filter((x) => x !== uid) : [...u.pinned, uid];
      return u;
    });
  }
  setPhaseOverride(uid: string, phase: Phase | null) {
    return this.updateUser((u) => {
      if (phase) u.phaseOverrides[uid] = phase;
      else delete u.phaseOverrides[uid];
      return u;
    });
  }
  /** Show the active list in phase sections, or as the plain load order. Remembered in settings. */
  setByPhase(v: boolean) {
    return this.updateSettings({ listByPhase: v });
  }
  /** Show or hide one of the optional list columns. */
  setListColumn(key: string, on: boolean) {
    // The order the columns appear in, whatever order they were switched on in. Time is first
    // because it sits left of Cost, and Cost is not in here: it follows showWeight.
    const order = ["time", "load", "versions", "phase", "group"];
    const set = new Set(this.listColumns);
    on ? set.add(key) : set.delete(key);
    return this.updateSettings({ listColumns: order.filter((k) => set.has(k)) });
  }
  /** Remember a dragged column width (null puts the default back). */
  setColumn(key: string, px: number | null) {
    const columns = { ...this.columns };
    if (px == null) delete columns[key];
    else columns[key] = Math.round(px);
    return this.updateSettings({ columns });
  }
  updateSettings(patch: Partial<Settings>) {
    if (!this.snap) return;
    const next: Settings = { ...structuredClone($state.snapshot(this.snap.settings)), ...patch };
    return this.run("Saving settings…", async () => this.apply(await api.updateSettings(next)));
  }
  refreshWeights() {
    return this.run("Fetching Circinus weights…", async () => {
      const n = await api.refreshWeights();
      await this.refresh();
      this.say(`Circinus weight: ${n} mods have figures`);
    });
  }
  updateDatabases() {
    return this.run("Updating databases…", async () => {
      const report = await api.updateDatabases();
      await this.refresh();
      this.say(report.join(" · "));
    });
  }

  // ---- a newer Circinus ----
  /** The launch-time check (in the backend) found one. */
  private onUpdateFound(c: UpdateCheck) {
    this.appVersion = c.current;
    this.update = c;
    this.updateStatus = { text: `${c.version} is available`, kind: "ok" };
  }
  /** Check now: ask circinus.sh and say what it answered, in Settings and, on failure, as a toast. */
  async checkForUpdates() {
    if (this.updateChecking) return;
    this.updateChecking = true;
    try {
      const c = await api.updateCheck();
      this.appVersion = c.current;
      this.update = c.available ? c : null;
      this.updateStatus = { text: c.available ? `${c.version} is available` : `Circinus ${c.current} is the newest`, kind: "ok" };
      // Asking again is a way of asking to see the banner again.
      if (c.available) this.dismissed = this.dismissed.filter((d) => d !== "update");
    } catch (e) {
      this.updateStatus = { text: String(e), kind: "err" };
      this.say(String(e), "err");
    } finally {
      this.updateChecking = false;
    }
  }
  /** Download, verify, install and restart. Progress arrives as events; on success the app is gone. */
  async installUpdate() {
    const u = this.update;
    if (!u || (this.updateProgress && this.updateProgress.phase !== "failed")) return;
    this.updateProgress = { phase: "downloading", version: u.version ?? "", downloaded: 0, total: null };
    try {
      await api.updateInstall();
    } catch (e) {
      this.updateProgress = { phase: "failed", version: u.version ?? "", downloaded: this.updateProgress?.downloaded ?? 0, total: this.updateProgress?.total ?? null, error: String(e) };
      this.say(String(e), "err");
    }
  }

  phaseInfo(phase: Phase) {
    return PHASES.find((p) => p.id === phase)!;
  }
  placement(uid: string): Placement | undefined {
    return this.placementByUid.get(uid);
  }
  issueUid(i: Issue) {
    return primaryUid(i);
  }
}

export const store = new Store();

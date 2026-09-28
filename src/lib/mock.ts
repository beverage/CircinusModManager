// Browser-only stand-in for the Rust backend: lets `npm run dev` show the UI with example data.
// Nothing here ships in the Tauri build path (api.ts only imports it outside Tauri).

import type { Announcement, BuiltinRule, Chain, ChainStep, Instance, Issue, LaunchSettings, Locations, ModChange, ModInfo, ModPatchDetail, ModPatches, Patcher, PatchJob, PatchReport, PatchSummary, PatchTarget, Phase, Placement, QueueState, Rule, Settings, Snapshot, SortResult, Source, TargetGroup, TexState, UserData, Weight } from "./types";
import { patchTargetName, PHASES } from "./types";

type Seed = [name: string, author: string, pkg: string, pfid: string | null, src: Source, phase: Phase, group: string, ver: string[], size: number, flags?: string];

const SEED: Seed[] = [
  ["RimWorld", "Ludeon Studios", "ludeon.rimworld", null, "ludeon", "core", "core", ["1.6"], 1.9e9, "defs"],
  ["Royalty", "Ludeon Studios", "ludeon.rimworld.royalty", null, "ludeon", "core", "core", ["1.6"], 168e6, "defs"],
  ["Ideology", "Ludeon Studios", "ludeon.rimworld.ideology", null, "ludeon", "core", "core", ["1.6"], 203e6, "defs"],
  ["Biotech", "Ludeon Studios", "ludeon.rimworld.biotech", null, "ludeon", "core", "core", ["1.6"], 241e6, "defs"],
  ["Anomaly", "Ludeon Studios", "ludeon.rimworld.anomaly", null, "ludeon", "core", "core", ["1.6"], 312e6, "defs"],
  ["Odyssey", "Ludeon Studios", "ludeon.rimworld.odyssey", null, "ludeon", "core", "core", ["1.6"], 298e6, "defs"],
  ["Prepatcher", "Zetrith", "zetrith.prepatcher", "2934420800", "workshop", "prepatch", "core", ["1.5", "1.6"], 1.2e6, "cs"],
  ["Harmony", "Brrainz", "brrainz.harmony", "2009463077", "workshop", "prepatch", "core", ["1.5", "1.6"], 0.9e6, "cs"],
  ["Visual Exceptions", "Brrainz", "brrainz.visualexceptions", "2538411704", "workshop", "prepatch", "core", ["1.5", "1.6"], 0.4e6, "cs"],
  ["HugsLib", "UnlimitedHugs", "unlimitedhugs.hugslib", "818773962", "workshop", "framework", "frameworks", ["1.5", "1.6"], 2.1e6, "cs"],
  ["Vanilla Expanded Framework", "Oskar Potocki, Taranchuk", "oskarpotocki.vanillafactionsexpanded.core", "2023507013", "workshop", "framework", "frameworks", ["1.5", "1.6"], 48e6, "cs"],
  ["Vehicle Framework", "SmashPhil", "smashphil.vehicleframework", "3014915404", "workshop", "framework", "frameworks", ["1.5", "1.6"], 31e6, "cs"],
  ["XML Extensions", "Imranfish", "imranfish.xmlextensions", "2574315206", "workshop", "framework", "frameworks", ["1.5", "1.6"], 0.7e6, "cs"],
  ["Adaptive Storage Framework", "bs, Wiri", "adaptive.storage.framework", "3033901359", "workshop", "framework", "frameworks", ["1.5", "1.6"], 3.4e6, "cs"],
  ["Vanilla Weapons Expanded", "Oskar Potocki", "vanillaexpanded.vwe", "1814383360", "workshop", "content", "qol", ["1.5", "1.6"], 22e6, "defs"],
  ["Vanilla Furniture Expanded", "Oskar Potocki", "vanillaexpanded.vfecore", "1718190143", "workshop", "content", "qol", ["1.5", "1.6"], 19e6, "defs"],
  ["Dubs Bad Hygiene", "Dubwise", "dubwise.dubsbadhygiene", "836308268", "workshop", "content", "qol", ["1.5", "1.6"], 27e6, "cs"],
  ["Rimatomics", "Dubwise", "dubwise.rimatomics", "1127530465", "workshop", "content", "qol", ["1.5", "1.6"], 58e6, "cs"],
  ["Hospitality", "Orion", "orion.hospitality", "753498552", "workshop", "content", "qol", ["1.5", "1.6"], 4.8e6, "cs"],
  ["Alpha Animals", "Sarg Bjornson", "sarg.alphaanimals", "1541721856", "workshop", "content", "qol", ["1.5", "1.6"], 113e6, "defs"],
  ["Alpha Biomes", "Sarg Bjornson", "sarg.alphabiomes", "1841354677", "workshop", "content", "qol", ["1.5", "1.6"], 96e6, "defs"],
  ["EdB Prepare Carefully", "EdB", "edbmods.edbpreparecarefully", "735106432", "workshop", "content", "qol", ["1.5", "1.6"], 1.6e6, "cs"],
  ["Character Editor", "VOID", "void.charactereditor", "1554146052", "local", "content", "qol", ["1.5", "1.6"], 2.9e6, "cs"],
  ["Pick Up And Haul", "Mehni", "mehni.pickupandhaul", "1279012058", "workshop", "content", "qol", ["1.5", "1.6"], 0.6e6, "cs"],
  ["Allow Tool", "UnlimitedHugs", "unlimitedhugs.allowtool", "761421485", "workshop", "content", "qol", ["1.5", "1.6"], 0.8e6, "cs"],
  ["Replace Stuff", "Uuugggg", "uuugggg.replacestuff", "1372003680", "workshop", "content", "qol", ["1.5", "1.6"], 0.5e6, "cs"],
  ["Interaction Bubbles", "Jaxe", "jaxe.bubbles", "1516158345", "workshop", "content", "qol", ["1.5", "1.6"], 0.3e6, "cs"],
  ["RimHUD", "Jaxe", "jaxe.rimhud", "1508850027", "workshop", "content", "qol", ["1.5", "1.6"], 0.9e6, "cs"],
  ["Better Pawn Control", "VouLT", "voult.betterpawncontrol", "1541460369", "workshop", "content", "qol", ["1.5", "1.6"], 1.1e6, "cs"],
  ["Combat Extended", "CE Team", "ceteam.combatextended", "2890901044", "steamcmd", "content", "qol", ["1.5", "1.6"], 141e6, "cs"],
  ["RIMMSqol", "Razuhl", "razuhl.rimmsqol", "1084452457", "workshop", "content", "qol", ["1.5", "1.6"], 3.2e6, "cs"],
  ["Camera+", "Brrainz", "brrainz.cameraplus", "867467808", "workshop", "content", "visual", ["1.5", "1.6"], 0.4e6, "cs"],
  ["Dubs Mint Menus", "Dubwise", "dubwise.dubsmintmenus", "1446523594", "workshop", "content", "qol", ["1.5", "1.6"], 1.7e6, "cs"],
  ["Alpha Animals - CE Patch", "Community", "community.alphaanimals.ce", "2979912040", "workshop", "patch", "qol", ["1.5", "1.6"], 0.2e6, "xml"],
  ["Bad Hygiene × VFE Patch", "Community", "community.dbh.vfe", "2814471152", "workshop", "patch", "qol", ["1.6"], 0.1e6, "xml"],
  ["Hospitality - Casino Patch", "Community", "community.hospitality.casino", "2881264430", "git", "patch", "qol", ["1.5"], 0.1e6, "xml"],
  ["Vanilla Textures Expanded", "Oskar Potocki", "vanillaexpanded.vtexe", "2032492919", "workshop", "texture", "visual", ["1.5", "1.6"], 168e6, "tex"],
  ["Vanilla Textures Expanded - Variations", "Oskar Potocki", "vanillaexpanded.vtexe.variations", "2035869776", "workshop", "texture", "visual", ["1.5", "1.6"], 41e6, "tex"],
  ["Retro Wall Textures", "Nyx", "nyx.retrowalls", "3187722041", "workshop", "texture", "visual", ["1.5", "1.6"], 6e6, "tex"],
  ["Pawn Textures Redux", "Kaeri", "kaeri.pawntexturesredux", "2760111925", "workshop", "texture", "visual", ["1.4", "1.5"], 88e6, "tex"],
  ["Performance Fish", "bs", "bs.performance", "3105420219", "workshop", "optimization", "performance", ["1.5", "1.6"], 2.4e6, "cs"],
  ["Dubs Performance Analyzer", "Dubwise", "dubwise.dubsperformanceanalyzer", "2222707451", "workshop", "optimization", "performance", ["1.5", "1.6"], 1.9e6, "cs"],
  ["RocketMan", "Krkr", "krkr.rocketman", "2479389928", "workshop", "optimization", "performance", ["1.5", "1.6"], 3.1e6, "cs"],
  ["Graphics Settings+", "Telardo", "telardo.graphicssettings", "1541713450", "workshop", "optimization", "performance", ["1.5", "1.6"], 0.6e6, "cs"],
  // inactive
  ["Vanilla Psycasts Expanded", "Oskar Potocki", "vanillaexpanded.vpsycastse", "2842502659", "workshop", "content", "qol", ["1.5", "1.6"], 61e6, "cs off"],
  ["Save Our Ship 2", "Kentington", "kentington.saveourship2", "1909914131", "workshop", "content", "qol", ["1.5"], 214e6, "cs off"],
  ["Rimefeller", "Dubwise", "dubwise.rimefeller", "1321849735", "workshop", "content", "qol", ["1.5", "1.6"], 33e6, "cs off"],
  ["Medieval Overhaul", "SirMashedPotato", "dankpyon.medieval.overhaul", "2553700067", "workshop", "content", "qol", ["1.5", "1.6"], 402e6, "defs off"],
  ["RuntimeGC", "user19990313", "user19990313.runtimegc", "962732083", "local", "optimization", "performance", ["1.4"], 0.4e6, "cs off"],
  ["Realistic Rooms Rewritten", "Lucifer", "lucifer.realisticroomsrewritten", "2559782534", "steamcmd", "content", "qol", ["1.5", "1.6"], 0.2e6, "cs off"],
  ["Ancient Urban Ruins", "MO", "mo.ancienturbanruins", "3208227718", "workshop", "content", "qol", ["1.5", "1.6"], 87e6, "defs off"]
];

function mod(s: Seed): ModInfo {
  const [name, author, pkg, pfid, src, , , ver, size, flags = ""] = s;
  const uid = `C:\\Mods\\${pkg}`;
  const cs = flags.includes("cs");
  const tex = flags.includes("tex");
  const xml = flags.includes("xml");
  return {
    uid,
    path: uid,
    packageId: pkg,
    name,
    authors: author.split(",").map((a) => a.trim()),
    description: `${name}: example description. Real descriptions come from About.xml.`,
    supportedVersions: ver,
    publishedFileId: pfid ? Number(pfid) : undefined,
    source: src,
    rules: { loadAfter: src === "ludeon" ? [] : ["brrainz.harmony"], loadBefore: [], forceLoadAfter: [], forceLoadBefore: [], incompatibleWith: [], dependencies: src === "ludeon" ? [] : [{ packageId: "brrainz.harmony", displayName: "Harmony" }] },
    contents: (() => {
      const defs = flags.includes("defs") || (!cs && !tex && !xml) ? 40 : cs ? 6 : 0;
      const textures = tex ? 300 : 12;
      // Load figures shaped like the real thing: XML by size, patches by count, pixels for PNGs
      // without DDS, DLLs by size. The heavy XPath share is what makes a patch mod expensive.
      const patchOps = xml ? 60 : defs ? 8 : 0;
      const heavyOps = xml ? 12 : 0;
      const pngPixels = textures * 512 * 512;
      const load = { defBytes: defs * 14_000, patchBytes: patchOps * 400, patchOps, heavyOps, pngPixels, pngBytes: textures * 60_000, ddsBytes: 0, dllBytes: cs ? Math.min(size / 4, 3e6) : 0, soundBytes: 0, scoreMs: 0 };
      load.scoreMs = Math.round((load.defBytes / 1024) * 0.25 + (load.patchOps - load.heavyOps) * 0.6 + load.heavyOps * 20 + load.pngPixels * 8e-6 + (cs ? 2 * 15 + (load.dllBytes / 1048576) * 60 : 0));
      return { assemblies: cs ? 2 : 0, patches: xml ? 3 : 0, defs, textures, dds: 0, sounds: 0, languages: 1, bundlesHarmony: false, sizeBytes: size, load };
    })(),
    // Spread over the last couple of years rather than one date for everything: a sort with
    // every value equal proves nothing about the sort. Steam's own date exists only where Steam
    // is involved, which is the case the Sort menu has to get right.
    modified: 1_690_000_000 + (hash(pkg) % 60_000_000),
    updated: src === "workshop" || src === "steamcmd" ? 1_700_000_000 + (hash(pkg + "s") % 55_000_000) : 0,
    kind: src === "ludeon" ? "official" : cs ? "code" : tex ? "textures" : "xml"
  };
}

/** A small stable hash, so the mock's dates are varied but the same on every run. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const mods: ModInfo[] = SEED.map(mod);
// A mod deployed by a dev tool: a hash-named link in the Mods folder pointing at a workspace.
{
  const m = mods.find((m) => m.packageId === "community.hospitality.casino")!;
  m.path = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld\\Mods\\6eb6cb0b799f";
  m.linkTarget = "C:\\Users\\Player\\AppData\\Roaming\\Modmixer\\workspace\\Mods\\6eb6cb0b799f";
}
const uidOf = (pkg: string) => mods.find((m) => m.packageId === pkg)!.uid;
let active: string[] = SEED.filter((s) => !(s[9] ?? "").includes("off")).map((s) => uidOf(s[2]));
// ?abovecore puts a framework above Core, the shape of list that made RimWorld reset itself.
if (typeof location !== "undefined" && location.search.includes("abovecore")) {
  const dbh = uidOf("dubwise.dubsbadhygiene");
  active = [dbh, ...active.filter((u) => u !== dbh)];
}
const phaseOfSeed: Record<string, Phase> = Object.fromEntries(SEED.map((s) => [uidOf(s[2]), s[5]]));
const byUid = new Map(mods.map((m) => [m.uid, m]));
/** Mods that arrived while Circinus was watching: ?new=3 (the default) for a handful, ?new=0 for
 *  none. Spread over the last few days so the New tab has something to sort by, and always a
 *  mixture of active and inactive, since a mod dropped in a folder is not in the list yet. */
const firstSeen: Record<string, number> = {};
const newUids: string[] = [];
/** Mods sitting in the wrong phase to begin with: what the list has, against what HALO knows. */
const misfiled: Record<string, Phase> = {};
// ?big=1100&jumble=40 — a list the size of a real modded install, with a given number of mods out
// of the place HALO would put them. Forty mods prove nothing about a view meant for a thousand.
if (typeof location !== "undefined" && /[?&]big=(\d+)/.test(location.search)) {
  const want = Number(location.search.match(/[?&]big=(\d+)/)![1]);
  const jumble = Number(location.search.match(/[?&]jumble=(\d+)/)?.[1] ?? Math.round(want / 40));
  const fill: Phase[] = ["prepatch", "framework", "content", "content", "content", "content", "patch", "texture", "late", "optimization"];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = mods.length; i < want; i++) {
    const base = SEED[i % SEED.length];
    const m = mod([`${base[0]} ${i}`, base[1], `filler.mod${i}`, "", base[4], base[5], base[6], base[7], base[8], base[9]] as Seed);
    mods.push(m);
    byUid.set(m.uid, m);
    phaseOfSeed[m.uid] = fill[Math.floor(rnd() * fill.length)];
  }
  // A library or a loader filed as ordinary content is the commonest thing HALO fixes, so some of
  // the list starts in the wrong phase: those mods change phase as well as number.
  const misfile = Number(location.search.match(/[?&]misfile=(\d+)/)?.[1] ?? Math.round(want / 60));
  const wrong = mods.filter((m) => m.source !== "ludeon" && (phaseOfSeed[m.uid] ?? "content") !== "content");
  for (let k = 0; k < Math.min(misfile, wrong.length); k++) misfiled[wrong[Math.floor(rnd() * wrong.length)].uid] = "content";
  // The list starts in the order the phases it *says* it has would give, then mods are pulled out
  // of it: what is left is drift, and drift is what buries the real moves on a list this long.
  const rank = (uid: string) => PHASES.findIndex((p) => p.id === (misfiled[uid] ?? phaseOfSeed[uid] ?? "content"));
  const list = mods.map((m) => m.uid).map((uid, i) => ({ uid, i })).sort((a, b) => rank(a.uid) - rank(b.uid) || a.i - b.i).map((x) => x.uid);
  for (let k = 0; k < jumble; k++) {
    const from = Math.floor(rnd() * list.length);
    if (byUid.get(list[from])?.source === "ludeon") continue;
    const [uid] = list.splice(from, 1);
    list.splice(Math.floor(rnd() * list.length), 0, uid);
  }
  active = list;
}
let dirty = false;

let user: UserData = {
  groups: [
    { id: "core", name: "Core", color: "blue", auto: { kind: "official" } },
    { id: "frameworks", name: "Frameworks", color: "teal", auto: { kind: "phase", phase: "framework" } },
    { id: "qol", name: "Quality of life", color: "green" },
    { id: "visual", name: "Visual", color: "amber" },
    { id: "performance", name: "Performance", color: "coral", phase: "optimization", auto: { kind: "phase", phase: "optimization" } },
    { id: "oskar", name: "Oskar's", color: "pink", auto: { kind: "author", name: "Oskar" } },
    { id: "rjw-x1y2", name: "Adult content", color: "violet", phase: "content", section: true }
  ],
  // Core, Frameworks and Performance fill themselves; the rest is assigned by hand.
  modGroups: { ...Object.fromEntries(SEED.filter((s) => !["core", "frameworks", "performance"].includes(s[6]) && !s[1].includes("Oskar")).map((s) => [uidOf(s[2]), s[6]])), [uidOf("orion.hospitality")]: "rjw-x1y2", [uidOf("dubwise.rimatomics")]: "rjw-x1y2" },
  pinned: [],
  phaseOverrides: {},
  notes: {},
  muted: [],
  ddsExcluded: [],
  packsRead: {},
  packsMuted: [],
  halo: { packagePhases: { "jaxe.rimhud": "content" }, namePhases: [{ needle: "Retro", phase: "texture" }], off: [], retarget: {} },
  collections: [
    (() => {
      const picks = SEED.filter((s) => s[3] && s[4] === "workshop").slice(4, 16);
      const items = picks.map((s) => Number(s[3]));
      return { id: 2932138122, name: "Rim of Madness: Complete", creator: "Curator", items: [...items, 3300000001], known: items.slice(0, -1), names: { ...Object.fromEntries(picks.map((s) => [s[3], s[0]])), "3300000001": "A mod not yet installed" }, checkedAt: 1_757_000_000, addedAt: 1_756_000_000, timeUpdated: 1_756_950_000 };
    })()
  ]
};

/** What a curator would have posted, if circinus.sh were serving the feed yet.
 *
 *  The unserved case is the one the release ships in, so it is a switch rather than an
 *  assumption: `?nopacks` empties this, and the app has to look deliberate with nothing in it. */
let packsCheckedAt = 1_757_005_000;

const PACK_POSTS: Announcement[] = [
  { id: "p3", pack: 2932138122, at: 1_757_004_800, author: "Curator", text: "1.6 patch is live. Update everything before loading a save — the Anomaly patch changed a def name and an old save will throw on load.", link: "https://example.com/patchnotes" },
  { id: "p2", pack: 2932138122, at: 1_756_940_000, author: "Curator", text: "Dropping Rimatomics from the pack next week. It is not the mod's fault; the CE patch has not been updated and I would rather not ship something that throws in combat.\n\nIf you are mid-colony, keep it — nothing will remove it for you." },
  { id: "p1", pack: 2932138122, at: 1_756_500_000, author: "Curator", text: "Welcome. Load order matters here: let HALO sort it rather than dragging things around, and read the pinned post before asking why a pawn is on fire." }
];

let settings: Settings = {
  locations: { gameDir: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld", configDir: "C:\\Users\\Player\\AppData\\LocalLow\\Ludeon Studios\\RimWorld by Ludeon Studios\\Config", localModsDir: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld\\Mods", workshopDir: "C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\294100" },
  dbSources: [
    { id: "community", label: "Community rules (RimSort)", url: "https://raw.githubusercontent.com/RimSort/Community-Rules-Database/main/communityRules.json", file: "communityRules.json", enabled: true },
    { id: "steam", label: "Steam Workshop database (RimSort)", url: "https://raw.githubusercontent.com/RimSort/Steam-Workshop-Database/main/steamDB.json", file: "steamDB.json", enabled: false },
    { id: "replacements", label: "Use This Instead (emipa606, MIT)", url: "https://raw.githubusercontent.com/emipa606/UseThisInstead/main/replacements.json.gz", file: "replacements.json.gz", enabled: false },
    { id: "noversion", label: "No Version Warning (emipa606, MIT)", url: "https://raw.githubusercontent.com/emipa606/NoVersionWarning/main/{version}/ModIdsToFix.xml", file: "ModIdsToFix.xml", enabled: false }
  ],
  showWeight: true,
  includeLocalRuns: true,
  alphabeticalWithinPhase: false,
  updateDatabasesOnStart: false,
  listByPhase: typeof location === "undefined" || !location.search.includes("plain"),
  haloAdvanced: typeof location !== "undefined" && location.search.includes("advanced"),
  listColumns: ["time", "load", "versions"],
  settingsVersion: 3,
  dds: { alphaFormat: "bc7", quality: "balanced", mipmaps: true, threads: 0, auto: false },
  launch: { method: "auto", executable: null, args: "", saveFirst: true },
  checkForUpdates: true
};

const rules: Rule[] = [
  { kind: "loadAfter", subject: "voult.betterpawncontrol", target: "oskarpotocki.vanillafactionsexpanded.core", source: "community", comment: "BPC patches VEF work tabs" },
  { kind: "loadBefore", subject: "voult.betterpawncontrol", target: "krkr.rocketman", source: "community" },
  { kind: "loadAfter", subject: "voult.betterpawncontrol", target: "dubwise.dubsbadhygiene", source: "user", comment: "my own: BPC bathing policy" },
  { kind: "incompatible", subject: "bs.performance", target: "razuhl.rimmsqol", source: "about" },
  { kind: "loadBottom", subject: "krkr.rocketman", source: "community", comment: "RocketMan must load last" },
  ...mods.filter((m) => m.source !== "ludeon").map((m): Rule => ({ kind: "loadAfter", subject: m.packageId, target: "brrainz.harmony", source: "about" }))
];

const weightSeed: Record<string, [number, boolean]> = {
  "krkr.rocketman": [3.4, true], "bs.performance": [0.3, true], "oskarpotocki.vanillafactionsexpanded.core": [6.2, true], "dubwise.dubsbadhygiene": [4.1, true], "sarg.alphaanimals": [1.4, true],
  "ceteam.combatextended": [17.8, true], "jaxe.rimhud": [2.6, true], "orion.hospitality": [1.1, true], "smashphil.vehicleframework": [7.9, true], "unlimitedhugs.hugslib": [0.2, true],
  "brrainz.harmony": [0.1, true], "dubwise.rimatomics": [2.2, true], "voult.betterpawncontrol": [0.6, true], "razuhl.rimmsqol": [3.0, false], "jaxe.bubbles": [0.4, true], "mehni.pickupandhaul": [1.9, true]
};
const weights: Record<string, Weight> = Object.fromEntries(
  Object.entries(weightSeed).map(([pkg, [share, ranked]]) => {
    const band = !ranked ? "insufficient" : share < 0.5 ? "negligible" : share <= 2 ? "light" : share <= 5 ? "moderate" : share <= 15 ? "heavy" : "veryheavy";
    return [pkg, { packageId: pkg, share, band, ranked, seen: 300, measured: 240, rankedRuns: ranked ? 200 : 12, installs: ranked ? 48 : 3, netLow: null, netHigh: null, withheld: false, origin: "api" } satisfies Weight];
  })
);

function placements(order: string[], halo = false): Placement[] {
  const reason: Record<Phase, string> = { core: "The game itself", prepatch: "Changes the game before other mods load", framework: "A library many mods use", content: "Adds content", patch: "Only patches, so it loads after what it changes", texture: "Only textures", late: "A rule says: load near the bottom", optimization: "Speeds up other mods, so it has to load after them" };
  return order.map((uid) => {
    const g = user.groups.find((g) => g.id === user.modGroups[uid]);
    if (!user.phaseOverrides[uid] && g?.section && g.phase) return { uid, phase: g.phase, reason: `In your group ${g.name}, which goes after ${PHASES.find((p) => p.id === g.phase)?.name.toLowerCase()}`, section: g.id };
    const m = byUid.get(uid)!;
    if (!user.phaseOverrides[uid] && !g?.phase && m.source !== "ludeon") {
      const byId = user.halo?.packagePhases[m.packageId];
      if (byId) return { uid, phase: byId, reason: "Your HALO rule for this package id" };
      const byName = user.halo?.namePhases.find((n) => n.needle.trim() && m.name.toLowerCase().includes(n.needle.trim().toLowerCase()));
      if (byName) return { uid, phase: byName.phase, reason: `Your HALO rule: name contains "${byName.needle.trim()}"` };
    }
    // Where it sits now can differ from where it belongs: that difference is what HALO corrects.
    if (!halo && !user.phaseOverrides[uid] && !g?.phase && misfiled[uid]) return { uid, phase: misfiled[uid], reason: "Where it sits in your list" };
    const phase = user.phaseOverrides[uid] ?? g?.phase ?? phaseOfSeed[uid] ?? "content";
    return { uid, phase, reason: user.phaseOverrides[uid] ? "Set by you" : reason[phase] };
  });
}

function issues(order: string[]): Issue[] {
  const idx = (pkg: string) => order.indexOf(uidOf(pkg));
  const out: Issue[] = [];
  const has = (pkg: string) => idx(pkg) >= 0;
  // Anything with Defs above the last official mod: the list RimWorld will reset.
  const lastOfficial = Math.max(...order.map((u, i) => (byUid.get(u)?.source === "ludeon" ? i : -1)));
  // The next official mod below each position, read once from the bottom up rather than searched
  // for at every row: on a thousand-mod list the search is what costs.
  const nextOfficial: (string | undefined)[] = new Array(order.length);
  for (let i = order.length - 1, seen: string | undefined; i >= 0; i--) {
    nextOfficial[i] = seen;
    if (byUid.get(order[i])?.source === "ludeon") seen = order[i];
  }
  for (const [i, u] of order.entries()) {
    const m = byUid.get(u);
    if (!m || i >= lastOfficial || m.source === "ludeon" || phaseOfSeed[u] === "prepatch" || m.contents.defs === 0) continue;
    out.push({ kind: "aboveOfficial", uid: u, officialUid: nextOfficial[i]!, declared: false });
  }
  if (has("voult.betterpawncontrol") && has("oskarpotocki.vanillafactionsexpanded.core") && idx("voult.betterpawncontrol") < idx("oskarpotocki.vanillafactionsexpanded.core"))
    out.push({ kind: "orderViolation", uid: uidOf("voult.betterpawncontrol"), targetUid: uidOf("oskarpotocki.vanillafactionsexpanded.core"), rule: "loadAfter", source: "community", comment: "BPC patches VEF work tabs" });
  if (has("bs.performance") && has("razuhl.rimmsqol")) out.push({ kind: "incompatible", uid: uidOf("razuhl.rimmsqol"), otherUid: uidOf("bs.performance"), source: "about" });
  // A dependency that is not installed but names its Workshop page: the Subscribe action's case.
  if (has("ceteam.combatextended")) out.push({ kind: "missingDependency", uid: uidOf("ceteam.combatextended"), dependency: "some.missing.mod", displayName: "Some Missing Mod", workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=999" });
  for (const m of mods) if (order.includes(m.uid) && m.source !== "ludeon" && !m.supportedVersions.includes("1.6")) out.push({ kind: "versionMismatch", uid: m.uid, supported: m.supportedVersions });
  if (has("krkr.rocketman")) {
    const after = order.slice(idx("krkr.rocketman") + 1).filter((u) => phaseOfSeed[u] !== "optimization");
    if (after.length) out.push({ kind: "misplacedOptimization", uid: uidOf("krkr.rocketman"), afterUids: after });
  }
  if (has("vanillaexpanded.vtexe") && has("nyx.retrowalls")) {
    const a = uidOf("vanillaexpanded.vtexe"), b = uidOf("nyx.retrowalls");
    const uids = idx("vanillaexpanded.vtexe") < idx("nyx.retrowalls") ? [a, b] : [b, a];
    for (const p of ["things/building/linked/wall_atlas", "things/building/linked/wallsmooth_atlas", "things/building/linked/wallbricks_atlas", "things/building/door/door_mover"]) out.push({ kind: "textureCollision", path: p, uids, winnerUid: uids[1] });
  }
  return out;
}

// Mods that arrived while Circinus was watching. Runs after the generators above so it can pick
// from the whole library, not just the seeds.
{
  const want = typeof location !== "undefined" ? Number(location.search.match(/[?&]new=(\d+)/)?.[1] ?? 3) : 3;
  const day = 86400;
  const nowSec = Math.floor(Date.now() / 1000);
  // Never the game's own content: RimWorld did not arrive last Tuesday.
  const candidates = mods.filter((m) => m.source !== "ludeon");
  for (let k = 0; k < Math.min(want, candidates.length); k++) {
    // Spread over hours and days both, so sorting by arrival has something to say and the
    // newest is not simply the first one in the file.
    const m = candidates[(k * 37 + 11) % candidates.length];
    if (firstSeen[m.uid]) continue;
    firstSeen[m.uid] = nowSec - (k % 2 === 0 ? 3600 * (k + 1) : day * (k + 1));
    newUids.push(m.uid);
  }
  newUids.sort((a, b) => firstSeen[b] - firstSeen[a]);
}

function snapshot(): Snapshot {
  return {
    locations: settings.locations,
    gameVersion: { full: "1.6.4530 rev1235", majorMinor: "1.6" },
    mods,
    active,
    missing: ["some.missing.mod"],
    issues: issues(active),
    placements: placements(active),
    rules,
    user,
    settings,
    weights,
    weightsFetchedAt: 1_757_000_000,
    dirty,
    currentList: currentList() ?? undefined,
    namedLists: namedLists().map((l) => ({ name: l.name, path: `C:\\Users\\Player\\AppData\\Local\\Circinus\\lists\\named\\${current}\\${l.name}.xml`, count: l.uids.length, updatedAt: l.updatedAt, gameVersion: "1.6.4530 rev1235" })),
    instance: instances.find((i) => i.id === current)!,
    announcements: (new URLSearchParams(location.search).has("nopacks") ? [] : PACK_POSTS).filter((a) => !(user.packsMuted ?? []).includes(a.pack)),
    announcementsCheckedAt: packsCheckedAt,
    // Only what is switched on, the way the backend now reports it: a source that is off is not
    // read and does not claim to be loaded. The mock said both were loaded whatever the switches
    // did, which is exactly the bug it should have been showing.
    dbLoaded: [
      ...(settings.dbSources.find((d) => d.id === "community")?.enabled ? ["communityRules.json (7,412 rules)"] : []),
      ...(settings.dbSources.find((d) => d.id === "steam")?.enabled ? ["steamDB.json (31,988 items)"] : [])
    ],
    scannedAt: 1_757_000_000,
    inspecting: 0,
    unreadable: [{ path: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld\\Mods\\deadbeef0000", reason: "links to C:\\Users\\Player\\AppData\\Roaming\\Modmixer\\workspace\\Mods\\deadbeef0000, which cannot be read: The system cannot find the path specified" }],
    issuesTruncated: 0,
    updates: [{ uid: uidOf("krkr.rocketman"), publishedFileId: 2479389928, name: "RocketMan", localModified: 1_750_000_000, remoteUpdated: 1_756_500_000, source: "workshop" }],
    updatesCheckedAt: 1_757_000_000,
    changes: acknowledged ? [] : changes(),
    listChange: acknowledged ? null : { added: ["voult.betterpawncontrol"], removed: ["some.missing.mod"], reordered: true, moves: [{ packageId: "krkr.rocketman", from: 41, to: 12 }, { packageId: "jaxe.rimhud", from: 9, to: 30 }] },
    changesSince: 1_756_900_000,
    dds: ddsIndex,
    listReset: resetSimulated ? { previousCount: 44, restoreFrom: savedLists[0] } : null,
    firstSeen,
    newUids
  };
}

/** A copy of HALO's rule table (the backend is the source of truth; this keeps the preview honest). */
const HALO_RULES: BuiltinRule[] = [
  { key: "official", signal: "The game and its DLC", detail: "Core, then the DLCs in release order. Everything that ships Defs must load after them, because a def can only inherit from mods above it; this cannot be switched off.", phase: "core", ids: [], editable: false },
  { key: "prepatch-ids", signal: "Known pre-patchers", detail: "Harmony, Prepatcher, Fishery, Visual Exceptions: they change the game before other mods load and ship no Defs of their own.", phase: "prepatch", ids: ["zetrith.prepatcher", "jikulopo.prepatcher", "brrainz.harmony", "brrainz.visualexceptions", "bs.fishery"], editable: true },
  { key: "top", signal: "Asks to load before the game and has no Defs", detail: "About.xml says it loads before Core (or it is a known loading-screen mod), and with no Defs there is nothing to lose its parents up there.", phase: "prepatch", ids: ["me.samboycoding.betterloading", "ilyvion.loadingprogress", "taranchuk.fastergameloading", "pirateby.harmony.optimizer", "automatic.startupimpact"], editable: true },
  { key: "rule-top", signal: "A rule says: load near the top", detail: "A community or user rule marks it loadTop.", phase: "framework", ids: [], editable: true },
  { key: "optimizer", signal: "Known performance mod, or code without Defs named like one", detail: "RocketMan, Performance Fish and friends, or a code-only mod whose name says performance, optimiser or FPS: it has to see every other mod, so it loads last.", phase: "optimization", ids: ["krkr.rocketman", "bs.performance", "taranchuk.performanceoptimizer", "dubwise.dubsperformanceanalyzer", "telardo.graphicssettings", "notfood.performancefish", "user19990313.runtimegc", "mlie.runtimegc"], editable: true },
  { key: "rule-bottom", signal: "A rule says: load near the bottom", detail: "A community or user rule marks it loadBottom. Its add-ons follow it.", phase: "late", ids: [], editable: true },
  { key: "framework-ids", signal: "Known frameworks", detail: "Libraries many mods build on: HugsLib, Vanilla Expanded Framework, Vehicle Framework, XML Extensions, Combat Extended…", phase: "framework", ids: ["unlimitedhugs.hugslib", "oskarpotocki.vanillafactionsexpanded.core", "smashphil.vehicleframework", "imranfish.xmlextensions", "adaptive.storage.framework", "aoba.framework", "aoba.exosuit.framework", "ebsg.framework", "owlchemist.cherrypicker", "redmattis.betterprerequisites", "vanillaexpanded.backgrounds", "thesepeople.ritualattachableoutcomes", "ceteam.combatextended"], editable: true },
  { key: "dependents", signal: "Code that three or more active mods need, with few Defs, not built on a framework", detail: "Being depended on is not enough (VFE Empire has add-ons and is content); a library is mostly code, ships at most a few dozen Def files, and is not itself built on a known framework.", phase: "framework", ids: [], editable: true },
  { key: "name-library", signal: "Named framework, library, lib or api, and has code", detail: "The name says library and there is a DLL; a patch is not one however it is named.", phase: "framework", ids: [], editable: true },
  { key: "texture-pack", signal: "Only textures, or a texture mod that replaces what another replaces", detail: "No code, no Defs, just Textures; or named retexture. Later packs win, so they sort together where the order between them is visible.", phase: "texture", ids: [], editable: true },
  { key: "patch-only", signal: "Only patches", detail: "Patches and nothing else: it loads after what it changes.", phase: "patch", ids: [], editable: true },
  { key: "name-patch", signal: "Named patch or compat", detail: "Named like a patch and either has no code or joins two or more dependencies.", phase: "patch", ids: [], editable: true },
  { key: "content", signal: "Everything else", detail: "Things, pawns, biomes, rules: the ordinary content mod.", phase: "content", ids: [], editable: false }
];

const resetSimulated = typeof location !== "undefined" && location.search.includes("reset");
// Three instances, the way a player who keeps a vanilla-ish game, a CE playthrough and a
// modding sandbox would have them: two share the game folder and differ only in config, and
// two share the Workshop folder. Each owns its named lists and remembers which one is open.
const STEAM = "C:\\Program Files (x86)\\Steam\\steamapps";
const launchDefaults: LaunchSettings = { method: "auto", executable: null, args: "", saveFirst: true };
const instances: Instance[] = [
  { id: "default", name: "1.6 vanilla-ish", locations: { gameDir: `${STEAM}\\common\\RimWorld`, configDir: "C:\\Users\\Player\\AppData\\LocalLow\\Ludeon Studios\\RimWorld by Ludeon Studios\\Config", localModsDir: `${STEAM}\\common\\RimWorld\\Mods`, workshopDir: `${STEAM}\\workshop\\content\\294100` }, launch: { ...launchDefaults }, createdAt: 1_740_000_000 },
  { id: "ce-playthrough", name: "CE playthrough", locations: { gameDir: `${STEAM}\\common\\RimWorld`, configDir: "D:\\RimWorld\\CE\\Config", localModsDir: "D:\\RimWorld\\CE\\Mods", workshopDir: `${STEAM}\\workshop\\content\\294100` }, launch: { ...launchDefaults, args: "-popupwindow" }, createdAt: 1_750_000_000 },
  { id: "modding-sandbox", name: "Modding sandbox", locations: { gameDir: "D:\\RimWorld\\1.5", configDir: "D:\\RimWorld\\1.5\\Config", localModsDir: "D:\\RimWorld\\1.5\\Mods", workshopDir: null }, launch: { ...launchDefaults, method: "executable" }, createdAt: 1_756_000_000 }
];
let current = "default";
// Named lists, kept in memory for the preview: each instance has its own.
const listsPerInstance: Record<string, { name: string; uids: string[]; updatedAt: number }[]> = {
  default: [
    { name: "Vanilla plus", uids: SEED.filter((s) => s[4] === "ludeon" || s[5] === "framework").map((s) => uidOf(s[2])), updatedAt: 1_756_990_000 },
    { name: "Full run", uids: SEED.filter((s) => !(s[9] ?? "").includes("off")).map((s) => uidOf(s[2])), updatedAt: 1_756_900_000 }
  ],
  "ce-playthrough": [{ name: "CE core", uids: SEED.filter((s) => s[4] === "ludeon").map((s) => uidOf(s[2])), updatedAt: 1_756_500_000 }],
  "modding-sandbox": []
};
const currentListPerInstance: Record<string, string | null> = { default: null, "ce-playthrough": "CE core", "modding-sandbox": null };
const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "instance";
/** Where the game would keep its config and saves for the instance that is open, when that is
 *  not the usual folder — mirrors instances::save_data_folder on the Rust side. */
function mockSaveDataFolder(): string | null {
  const cfg = settings.locations.configDir;
  if (!cfg || cfg.includes("LocalLow")) return null;
  return /[\\/]config$/i.test(cfg) ? cfg.replace(/[\\/]config$/i, "") : cfg;
}
function mockLaunchArgs(): string[] {
  const args = (settings.launch.args ?? "").split(/\s+/).filter(Boolean);
  if (args.some((a) => a.toLowerCase().startsWith("-savedatafolder"))) return args;
  const folder = mockSaveDataFolder();
  return folder ? [...args, `-savedatafolder=${folder}`] : args;
}
const namedLists = () => (listsPerInstance[current] ??= []);
const currentList = () => currentListPerInstance[current] ?? null;
const setCurrentList = (name: string | null) => (currentListPerInstance[current] = name);
const savedLists = [
  { path: "C:\\Users\\Player\\AppData\\Local\\Circinus\\lists\\1757000000-saved.xml", savedAt: 1_757_000_000, label: "saved", count: 44, gameVersion: "1.6.4530 rev1235" },
  { path: "C:\\Users\\Player\\AppData\\Local\\Circinus\\lists\\1756900000-seen.xml", savedAt: 1_756_900_000, label: "seen", count: 41, gameVersion: "1.6.4530 rev1235" },
  { path: "C:\\Users\\Player\\AppData\\Local\\Circinus\\lists\\1756800000-before-reset.xml", savedAt: 1_756_800_000, label: "before-reset", count: 43, gameVersion: "1.6.4530 rev1235" }
];

/** Mock manifest: a few mods already converted. */
let ddsIndex: Record<string, Snapshot["dds"][string]> = Object.fromEntries(
  ["oskarpotocki.vanillafactionsexpanded.core", "vanillaexpanded.vtexe", "ceteam.combatextended"].map((pkg, i) => {
    const m = mods.find((x) => x.packageId === pkg)!;
    const n = Math.max(1, Math.round(m.contents.textures * 0.9));
    return [m.uid, { count: n, ddsBytes: n * 42_000 + i, pngBytes: n * 60_000, vramBefore: n * 350_000, newest: 1_756_800_000 }];
  })
);
let tex: TexState = { running: false, phase: "idle", progress: { total: 0, done: 0, converted: 0, failed: 0, pngBytes: 0, ddsBytes: 0, current: "" }, startedAt: 0, finishedAt: 0, errors: [], report: null };

// ---- code patches --------------------------------------------------------------------------
// A stand-in for what the Harmony scanner reports: a few methods several mods fight over, the
// long tail every code mod adds, and the places static reading cannot follow.

/** [target, kind, priority, declaringType, method]; the target reads `Namespace.Type::Method`. */
type MockPatch = [string, string, (number | null)?, string?, string?];

const PATCH_SEED: [pkg: string, harmonyId: string, patches: MockPatch[], manual: [string, string, string][]][] = [
  ["brrainz.harmony", "brrainz.harmony", [["Verse.Root::Start", "prefix", 800, "HarmonyMod.Bootstrap", "Prefix"]], []],
  [
    "unlimitedhugs.hugslib",
    "unlimitedhugs.hugslib",
    [
      ["Verse.Game::FinalizeInit", "postfix", null, "HugsLib.Patches.Game_FinalizeInit", "Postfix"],
      ["RimWorld.Pawn_JobTracker::StartJob", "postfix", null, "HugsLib.Patches.JobTracker", "Postfix"],
      ["RimWorld.MainMenuDrawer::DoMainMenuControls", "postfix", null, "HugsLib.Patches.MainMenu", "Postfix"],
      ["Verse.Root_Play::SetupForQuickTestPlay", "prefix", null, "HugsLib.Patches.QuickStart", "Prefix"]
    ],
    [["HugsLib.HugsLibController", "EarlyInitialize", "PatchAll() over the calling assembly"]]
  ],
  [
    "oskarpotocki.vanillafactionsexpanded.core",
    "oskarpotocki.vanillafactionsexpanded",
    [
      ["Verse.Pawn_HealthTracker::PreApplyDamage", "prefix", 600, "VFECore.Patch_PreApplyDamage", "Prefix"],
      ["Verse.Pawn::SpawnSetup", "postfix", null, "VFECore.Patch_SpawnSetup", "Postfix"],
      ["Verse.Game::FinalizeInit", "postfix", null, "VFECore.Patch_FinalizeInit", "Postfix"],
      ["Verse.Thing::get_MarketValue", "postfix", null, "VFECore.Patch_MarketValue", "Postfix"],
      ["RimWorld.Building_Bed::GetGizmos", "postfix", null, "VFECore.Patch_BedGizmos", "Postfix"],
      ["Verse.GenSpawn::Spawn", "postfix", null, "VFECore.Patch_GenSpawn", "Postfix"],
      ["Verse.Pawn::.ctor", "postfix", null, "VFECore.Patch_PawnCtor", "Postfix"]
    ],
    []
  ],
  [
    "smashphil.vehicleframework",
    "smashphil.vehicleframework",
    [
      ["Verse.PathFinder::FindPath", "transpiler", null, "Vehicles.PathingPatches", "Transpiler"],
      ["Verse.GenGrid::Walkable", "prefix", 400, "Vehicles.GridPatches", "Prefix"],
      ["Verse.MapDrawer::DrawMapMesh", "postfix", null, "Vehicles.RenderPatches", "Postfix"],
      ["Verse.Thing::set_Position", "prefix", null, "Vehicles.PositionPatches", "Prefix"]
    ],
    []
  ],
  [
    "ceteam.combatextended",
    "ceteam.combatextended",
    [
      ["Verse.Pawn_HealthTracker::PreApplyDamage", "prefix", null, "CombatExtended.HarmonyCE.Harmony_PreApplyDamage", "Prefix"],
      ["Verse.DamageWorker_AddInjury::ApplyDamageToPart", "transpiler", null, "CombatExtended.HarmonyCE.Harmony_ApplyDamageToPart", "Transpiler"],
      ["Verse.AI.JobGiver_Work::TryGiveJob", "transpiler", null, "CombatExtended.HarmonyCE.Harmony_JobGiver_Work", "Transpiler"],
      ["Verse.Pawn::Tick", "postfix", null, "CombatExtended.HarmonyCE.Harmony_Pawn", "Postfix"],
      ["RimWorld.Projectile_Explosive::Impact", "prefix", null, "CombatExtended.HarmonyCE.Harmony_Impact", "Prefix"],
      ["Verse.Thing::get_MarketValue", "postfix", null, "CombatExtended.HarmonyCE.Harmony_MarketValue", "Postfix"],
      ["RimWorld.WorkGiver_Scanner::HasJobOnThing", "prefix", null, "CombatExtended.HarmonyCE.Harmony_WorkGiver", "Prefix"]
    ],
    [["CombatExtended.HarmonyCE.HarmonyBase", ".cctor", "Patch(…) called with a computed target"]]
  ],
  [
    "mehni.pickupandhaul",
    "mehni.pickupandhaul",
    [
      ["Verse.AI.JobGiver_Work::TryGiveJob", "transpiler", null, "PickUpAndHaul.HarmonyPatches", "Transpiler"],
      ["Verse.AI.Toils_Haul::StartCarryThing", "prefix", null, "PickUpAndHaul.HarmonyPatches", "Prefix"],
      ["RimWorld.WorkGiver_Scanner::HasJobOnThing", "postfix", null, "PickUpAndHaul.HarmonyPatches", "Postfix"]
    ],
    []
  ],
  [
    "krkr.rocketman",
    "krkr.rocketman",
    [
      ["Verse.Pawn::Tick", "prefix", 800, "RocketMan.Optimizations.Pawn_Tick", "Prefix"],
      ["Verse.GenGrid::Walkable", "transpiler", null, "RocketMan.Optimizations.GenGrid", "Transpiler"],
      ["Verse.TickManager::DoSingleTick", "prefix", null, "RocketMan.Optimizations.TickManager", "Prefix"],
      ["Verse.MapDrawer::DrawMapMesh", "prefix", null, "RocketMan.Optimizations.MapDrawer", "Prefix"],
      ["RimWorld.CompRefuelable::CompTick", "prefix", null, "RocketMan.Optimizations.Refuelable", "Prefix"]
    ],
    []
  ],
  [
    "bs.performance",
    "bs.performancefish",
    [
      ["Verse.Pawn::Tick", "prefix", 600, "PerformanceFish.Pawns.PawnTick", "Prefix"],
      ["Verse.GenGrid::Walkable", "transpiler", null, "PerformanceFish.Pathfinding.GenGridCaching", "Transpiler"],
      ["Verse.PathFinder::FindPath", "transpiler", null, "PerformanceFish.Pathfinding.PathFinderCaching", "Transpiler"],
      ["Verse.DefDatabase`1::AddAllInMods", "prefix", null, "PerformanceFish.Defs.DefDatabaseCaching", "Prefix"],
      ["Verse.Thing::get_MarketValue", "prefix", null, "PerformanceFish.Things.MarketValueCaching", "Prefix"]
    ],
    []
  ],
  [
    "dubwise.dubsperformanceanalyzer",
    "dubwise.dubsanalyzer",
    [
      ["Verse.TickManager::DoSingleTick", "transpiler", null, "Analyzer.Profiling.H_TickManager", "Transpiler"],
      ["Verse.Game::FinalizeInit", "postfix", null, "Analyzer.Profiling.H_FinalizeInit", "Postfix"]
    ],
    [["Analyzer.Profiling.MethodTransplanting", "PatchMethods", "Patch(…) called with a target built at runtime"]]
  ],
  [
    "orion.hospitality",
    "orion.hospitality",
    [
      ["RimWorld.Pawn_JobTracker::StartJob", "prefix", null, "Hospitality.Patches.JobTracker_Patch", "Prefix"],
      ["Verse.Pawn::SpawnSetup", "postfix", null, "Hospitality.Patches.Pawn_Patch", "Postfix"],
      ["Verse.Game::FinalizeInit", "postfix", null, "Hospitality.Patches.Game_Patch", "Postfix"],
      ["RimWorld.Building_Bed::GetGizmos", "postfix", null, "Hospitality.Patches.Bed_Patch", "Postfix"]
    ],
    []
  ],
  [
    "voult.betterpawncontrol",
    "voult.betterpawncontrol",
    [
      ["RimWorld.Pawn_JobTracker::StartJob", "prefix", 500, "BetterPawnControl.Patches.JobTracker", "Prefix"],
      ["RimWorld.Pawn_JobTracker::EndCurrentJob", "postfix", null, "BetterPawnControl.Patches.JobTracker", "Postfix"]
    ],
    []
  ],
  [
    "razuhl.rimmsqol",
    "razuhl.rimmsqol",
    [
      ["Verse.DefDatabase`1::AddAllInMods", "prefix", 900, "RIMMSqol.DefPatches", "Prefix"],
      ["Verse.Pawn_HealthTracker::AddHediff", "prefix", null, "RIMMSqol.HealthPatches", "Prefix"]
    ],
    [["RIMMSqol.QolBootstrap", "Apply", "Patch(…) called with a computed target"]]
  ],
  ["void.charactereditor", "void.charactereditor", [["Verse.Pawn::.ctor", "postfix", null, "CharacterEditor.PawnCtor", "Postfix"], ["Verse.Pawn_HealthTracker::AddHediff", "postfix", null, "CharacterEditor.Health", "Postfix"]], []],
  ["jaxe.rimhud", "jaxe.rimhud", [["Verse.MapDrawer::DrawMapMesh", "postfix", null, "RimHUD.Patch.MapDrawer", "Postfix"], ["Verse.Pawn::SpawnSetup", "postfix", null, "RimHUD.Patch.Pawn", "Postfix"]], []],
  ["jaxe.bubbles", "jaxe.bubbles", [["Verse.MapDrawer::DrawMapMesh", "postfix", null, "Bubbles.Patch.MapDrawer", "Postfix"]], []],
  ["unlimitedhugs.allowtool", "unlimitedhugs.allowtool", [["RimWorld.WorkGiver_Scanner::HasJobOnThing", "postfix", null, "AllowTool.Patches.WorkGiver", "Postfix"], ["Verse.AI.Toils_Haul::StartCarryThing", "postfix", null, "AllowTool.Patches.Toils", "Postfix"]], []],
  ["brrainz.cameraplus", "brrainz.cameraplus", [["Verse.MapDrawer::DrawMapMesh", "prefix", null, "CameraPlus.Patches", "Prefix"]], []],
  ["dubwise.dubsbadhygiene", "dubwise.badhygiene", [["Verse.GenSpawn::Spawn", "postfix", null, "DubsBadHygiene.Patches.GenSpawn", "Postfix"], ["RimWorld.CompRefuelable::CompTick", "postfix", null, "DubsBadHygiene.Patches.Refuelable", "Postfix"]], []],
  ["telardo.graphicssettings", "telardo.graphicssettings", [["Verse.MapDrawer::DrawMapMesh", "transpiler", null, "GraphicsSettings.Patches", "Transpiler"]], []],
  ["zetrith.prepatcher", "zetrith.prepatcher", [["Verse.Root::Start", "prefix", 900, "Prepatcher.Bootstrap", "Prefix"]], []]
];

/** `Verse.Pawn::get_HitPoints` back into the fields the scanner reports. */
function mockTarget(target: string, kind: string, priority: number | null, declaring: string, method: string): PatchTarget {
  const [type, raw] = target.split("::");
  const targetKind = raw === ".ctor" ? "constructor" : raw === ".cctor" ? "staticConstructor" : raw.startsWith("get_") ? "getter" : raw.startsWith("set_") ? "setter" : "normal";
  const targetMethod = targetKind === "constructor" || targetKind === "staticConstructor" ? null : raw.replace(/^(get|set)_/, "");
  return { declaringType: declaring, method, kind, targetType: type, targetMethod, targetKind, argumentTypes: null, priority, before: [], after: [], source: "attribute" };
}

/** Real RimWorld types and methods, so the bulk reads like a report rather than like filler. */
const BULK_TYPES = [
  "Verse.Pawn", "Verse.Pawn_HealthTracker", "Verse.Thing", "Verse.ThingWithComps", "Verse.Map", "Verse.MapDrawer", "Verse.TickManager", "Verse.Game",
  "Verse.GenSpawn", "Verse.DamageWorker", "Verse.DamageWorker_AddInjury", "Verse.Verb", "Verse.Verb_LaunchProjectile", "Verse.Projectile",
  "Verse.PawnGenerator", "Verse.PawnRenderer", "Verse.PawnGraphicSet", "Verse.GenDraw", "Verse.Widgets", "Verse.Listing_Standard",
  "Verse.AI.Pawn_PathFollower", "Verse.AI.PathFinder", "Verse.AI.JobDriver", "Verse.AI.Toils_Haul", "Verse.AI.ThinkNode_Priority",
  "RimWorld.Pawn_JobTracker", "RimWorld.Pawn_WorkSettings", "RimWorld.Pawn_NeedsTracker", "RimWorld.Pawn_SkillTracker", "RimWorld.Pawn_StoryTracker",
  "RimWorld.Building_Bed", "RimWorld.Building_WorkTable", "RimWorld.CompRefuelable", "RimWorld.CompPowerTrader", "RimWorld.WorkGiver_Scanner",
  "RimWorld.StoreUtility", "RimWorld.HaulAIUtility", "RimWorld.FoodUtility", "RimWorld.TradeUtility", "RimWorld.CaravanFormingUtility",
  "RimWorld.GenRecipe", "RimWorld.RecipeWorker", "RimWorld.IncidentWorker", "RimWorld.Storyteller", "RimWorld.StatWorker",
  "RimWorld.Planet.WorldGrid", "RimWorld.Planet.Settlement", "RimWorld.MainTabWindow_Inspect", "RimWorld.ITab_Pawn_Gear", "RimWorld.Dialog_ModSettings"
];
const BULK_METHODS = [
  "Tick", "TickRare", "TickLong", "SpawnSetup", "DeSpawn", "Destroy", "ExposeData", "PostMake", "PostLoad", "Notify_Spawned",
  "GetGizmos", "GetInspectString", "GetFloatMenuOptions", "DrawAt", "DrawGUIOverlay", "Print", "DrawExtraSelectionOverlays",
  "get_Label", "get_LabelCap", "set_Label", "get_MarketValue", "get_HitPoints", "set_HitPoints", "get_MaxHitPoints",
  "TryStartJob", "StartJob", "EndCurrentJob", "DetermineNextJob", "CleanupCurrentJob", "TryFindAndStartJob",
  "TryDegradeJob", "HasJobOnThing", "JobOnThing", "PotentialWorkThingsGlobal", "ShouldSkip",
  "TryFindBestBetterStoreCellFor", "TryFindStoreCellNearColonyDesperate", "HaulToStorageJob", "TryOpportunisticJob",
  "GenerateNewPawnInternal", "GeneratePawn", "TryGenerateNewPawnInternal", "GenerateTraits", "GenerateSkills",
  "RenderPawnAt", "RenderPawnInternal", "DrawEquipment", "ResolveAllGraphics", "ResolveApparelGraphics",
  "FindPath", "NeedNewPath", "StartPath", "PatherTick", "CostToMoveIntoCell",
  "ApplyDamageToPart", "Apply", "ApplyMeleeDamageToTarget", "TryCastShot", "Launch",
  "DoWindowContents", "DoRow", "Label", "CheckboxLabeled", "ButtonText", "FinalizeInit", "DoSingleTick", "DrawMapMesh"
];

/** The report the backend would build: per mod, per method, contested first. */
function patchReport(): PatchReport {
  const perMod: ModPatches[] = [];
  const byTarget = new Map<string, Patcher[]>();
  for (const [pkg, harmonyId, patches, manual] of PATCH_SEED) {
    const m = mods.find((x) => x.packageId === pkg);
    if (!m || !active.includes(m.uid)) continue;
    const row: ModPatches = { uid: m.uid, name: m.name, assemblies: 1, patches: patches.length, prefixes: 0, postfixes: 0, transpilers: 0, manual: manual.length, harmonyIds: [harmonyId], unreadable: [] };
    for (const [target, kind, priority, declaring, method] of patches) {
      if (kind === "prefix") row.prefixes++;
      else if (kind === "postfix") row.postfixes++;
      else if (kind === "transpiler") row.transpilers++;
      const list = byTarget.get(target) ?? [];
      list.push({ uid: m.uid, modName: m.name, kind, declaringType: declaring ?? "", method: method ?? "", priority: priority ?? null, before: [], after: [] });
      byTarget.set(target, list);
    }
    perMod.push(row);
  }
  // Volume, on top of the named patches.
  //
  // The shape of the Patches screen is a volume problem: a real list is thousands of methods, and
  // that is why it is a virtualised list on a tab of its own rather than four hundred rows and an
  // apology. Thirty hand-written targets cannot show whether the window drawn over three thousand
  // rows lines up with the rows under it, or whether coming back lands where you left. So the mock
  // carries a synthetic bulk as well. Deterministic, so a failing assertion means a change.
  for (const m of mods) {
    if (!active.includes(m.uid) || m.packageId.startsWith("ludeon.")) continue;
    const h = hash(m.uid);
    const row = perMod.find((r) => r.uid === m.uid) ?? { uid: m.uid, name: m.name, assemblies: 1, patches: 0, prefixes: 0, postfixes: 0, transpilers: 0, manual: 0, harmonyIds: [m.packageId], unreadable: [] };
    if (!perMod.includes(row)) perMod.push(row);
    const n = 10 + (h % 46);
    for (let i = 0; i < n; i++) {
      // Real reports are lumpy: a few dozen methods every mod wants a piece of, and a long tail
      // nobody else touches. A flat spread would make contested methods almost impossible, which
      // is the opposite of the problem this screen exists for.
      const hot = i % 5 < 3;
      const pick = hash(`${m.uid}:${i}`);
      const type = BULK_TYPES[(hot ? pick % 14 : pick % BULK_TYPES.length)];
      const method = BULK_METHODS[(hot ? (pick >>> 8) % 12 : (pick >>> 8) % BULK_METHODS.length)];
      const kind = hot ? ((h + i) % 4 === 0 ? "transpiler" : (h + i) % 2 === 0 ? "prefix" : "postfix") : (h + i) % 7 === 0 ? "transpiler" : (h + i) % 3 === 0 ? "prefix" : "postfix";
      const target = `${type}::${method}`;
      const declaring = `${m.packageId.split(".").pop()}.Patches.${type.split(".").pop()}`;
      if (kind === "prefix") row.prefixes++;
      else if (kind === "postfix") row.postfixes++;
      else row.transpilers++;
      row.patches++;
      const list = byTarget.get(target) ?? [];
      if (list.some((p) => p.uid === m.uid)) continue;
      list.push({ uid: m.uid, modName: m.name, kind, declaringType: declaring, method: kind[0].toUpperCase() + kind.slice(1), priority: i % 9 === 0 ? 300 + (i % 5) * 100 : null, before: [], after: [] });
      byTarget.set(target, list);
    }
    // A couple of mods that could not be read at all, so that tab has something in it.
    if (h % 23 === 0) row.unreadable.push(`${m.packageId}.dll: not a managed assembly`);
  }

  // One mod prefixing its own target twice is its own business; two mods is a fight.
  const targets: TargetGroup[] = [...byTarget.entries()].map(([target, patchers]) => ({ target, patchers, contested: new Set(patchers.filter((p) => p.kind === "prefix" || p.kind === "transpiler").map((p) => p.uid)).size > 1 }));
  targets.sort((a, b) => Number(b.contested) - Number(a.contested) || b.patchers.length - a.patchers.length || a.target.localeCompare(b.target));
  perMod.sort((a, b) => b.patches - a.patches || a.name.localeCompare(b.name));
  return { perMod, targets, contested: targets.filter((t) => t.contested).length, scanned: perMod.length };
}

function patchSummary(r: PatchReport): PatchSummary {
  return { mods: r.perMod.length, assemblies: r.perMod.reduce((n, m) => n + m.assemblies, 0), targets: r.targets.length, contested: r.contested, unreadable: 0, seconds: 4 };
}

/** Mock: the scanner is present, and one run has already finished. */
let patchJob: PatchJob = { running: false, phase: "idle", done: 0, total: 0, current: "", startedAt: 1_757_009_996, finishedAt: 1_757_010_000, cancelled: false, error: null, summary: patchSummary(patchReport()) };
let patchDone = true;

function patchesForMod(uid: string): ModPatchDetail | null {
  const report = patchReport();
  const summary = report.perMod.find((m) => m.uid === uid);
  if (!summary) return null;
  const seed = PATCH_SEED.find(([pkg]) => mods.find((m) => m.packageId === pkg)?.uid === uid);
  // Read back out of the report rather than only out of the seed, so a mod carrying the synthetic
  // bulk opens onto its own methods instead of onto nothing.
  const targets = report.targets
    .flatMap((g) => g.patchers.filter((p) => p.uid === uid).map((p) => mockTarget(g.target, p.kind, p.priority, p.declaringType, p.method)))
    .sort((a, b) => patchTargetName(a).localeCompare(patchTargetName(b)));
  const manual = (seed?.[3] ?? []).map(([declaringType, method, detail]) => ({ declaringType, method, detail }));
  return { summary, targets, manual, contested: report.targets.filter((t) => t.contested && t.patchers.some((p) => p.uid === uid)) };
}

let acknowledged = false;
function changes(): ModChange[] {
  const c = (kind: ModChange["kind"], pkg: string, extra: Partial<ModChange> = {}): ModChange => {
    const m = mods.find((x) => x.packageId === pkg)!;
    return { kind, uid: m.uid, name: m.name, packageId: m.packageId, publishedFileId: m.publishedFileId ?? null, source: m.source, active: active.includes(m.uid), reasons: [], oldVersion: null, newVersion: m.modVersion ?? null, when: m.modified, ...extra };
  };
  return [
    c("updated", "oskarpotocki.vanillafactionsexpanded.core", { reasons: ["workshopUpdate"], when: 1_757_000_000 }),
    c("updated", "brrainz.harmony", { reasons: ["workshopUpdate", "versionChange"], oldVersion: "2.3.5", newVersion: "2.3.6", when: 1_756_990_000 }),
    c("updated", "ceteam.combatextended", { reasons: ["filesChanged"], when: 1_756_950_000 }),
    c("added", "lucifer.realisticroomsrewritten", { when: 1_756_940_000 }),
    { kind: "removed", uid: "C:\\RimWorld\\Mods\\OldMod", name: "Old Mod That Left", packageId: "someone.oldmod", publishedFileId: 123456789, source: "local", active: true, reasons: [], oldVersion: "1.0", newVersion: null, when: 0 }
  ];
}

function haloSort(): SortResult {
  const rank = (uid: string) => PHASES.findIndex((p) => p.id === placements([uid], true)[0].phase);
  const order = [...active].map((uid, i) => ({ uid, i })).sort((a, b) => rank(a.uid) - rank(b.uid) || a.i - b.i).map((x) => x.uid);
  // honour the two community rules in the seed
  const bpc = uidOf("voult.betterpawncontrol"), vef = uidOf("oskarpotocki.vanillafactionsexpanded.core");
  if (order.indexOf(bpc) < order.indexOf(vef)) { order.splice(order.indexOf(bpc), 1); order.splice(order.indexOf(vef) + 1, 0, bpc); }
  const rm = uidOf("krkr.rocketman");
  if (order.includes(rm)) { order.splice(order.indexOf(rm), 1); order.push(rm); }
  const moves: [string, number, number][] = order.map((uid, to) => [uid, active.indexOf(uid), to] as [string, number, number]).filter(([, from, to]) => from !== to);
  return { order, placements: placements(order, true), moves, issues: issues(order) };
}

const queue = {
  items: [
    { id: 2009463077, name: "Harmony", status: "done", attempts: 1, bytes: 935611, path: "C:\\RimWorld\\Mods\\2009463077", addedAt: 1, finishedAt: 2 },
    { id: 818773962, name: "HugsLib", status: "downloading", attempts: 0, addedAt: 1 },
    { id: 2023507013, name: "Vanilla Expanded Framework", status: "queued", attempts: 1, error: "Failure", addedAt: 1 },
    { id: 3014915404, name: "Vehicle Framework", status: "queued", attempts: 0, addedAt: 1 },
    { id: 1541460369, name: "Better Pawn Control", status: "failed", attempts: 4, error: "Timeout", addedAt: 1, finishedAt: 3 }
  ],
  throttle: { batchSize: 12, cleanStreak: 0, level: 1, cooldownUntil: null, last: { requested: 25, succeeded: 20, failed: 5, timedOut: 0, authFailed: false, stalled: false, seconds: 84 } },
  paused: false, currentBatch: [818773962, 2023507013, 3014915404], currentItem: 818773962, running: true, steamcmdInstalled: true, installing: false,
  log: ["Batch of 3 (batch size 12)", "Loading Steam API...OK", "Connecting anonymously to Steam Public...OK", "Waiting for client config...OK", "Downloading item 818773962 ..."]
} as const;

// ---- the merged defs -------------------------------------------------------------------------
// Enough of a merged document to build the view against: three-mod chains over one value, patches
// that hit nothing, defs two mods both ship, and a def tree with inherited nodes.

const ORIGIN_SEED: [pkg: string, file: string, patch: boolean][] = [
  ["ludeon.rimworld", "Defs/ThingDefs_Buildings/Buildings_Structure.xml", false],
  ["ludeon.rimworld", "Defs/ThingDefs_Misc/Weapons_Guns.xml", false],
  ["oskarpotocki.vanillafactionsexpanded.core", "1.6/Defs/ThingDefs/Buildings_Base.xml", false],
  ["vanillaexpanded.vwe", "1.6/Defs/ThingDefs/Weapons_Guns.xml", false],
  ["sarg.alphaanimals", "1.6/Defs/ThingDefs/Animals_Xenoloxodon.xml", false],
  ["vanillaexpanded.vfecore", "1.6/Defs/ThingDefs/Furniture_Beds.xml", false],
  ["ceteam.combatextended", "Patches/Weapons_Guns.xml", true],
  ["ceteam.combatextended", "Patches/Buildings_Structure.xml", true],
  ["community.alphaanimals.ce", "1.6/Patches/Animals.xml", true],
  ["community.dbh.vfe", "Patches/Furniture.xml", true],
  ["imranfish.xmlextensions", "Patches/Settings.xml", true],
  ["nyx.retrowalls", "Patches/Walls.xml", true]
];
const defsOrigins = () => [
  { uid: "", packageId: "", name: "the game", file: "", index: 0, isPatch: false },
  ...ORIGIN_SEED.map(([pkg, file, patch]) => {
    const m = mods.find((x) => x.packageId === pkg)!;
    return { uid: m.uid, packageId: pkg, name: m.name, file, index: Math.max(0, active.indexOf(m.uid)), isPatch: patch };
  })
];
// origin indexes, one past the seed's own (0 is the game itself)
const [CORE_B, CORE_W, VEF, VWE, ALPHA, VFE, CE_W, CE_B, AACE, DBH, XML, RETRO] = ORIGIN_SEED.map((_, i) => i + 1);

const OVERWRITES = [
  { def: "ThingDef/Wall", path: "statBases/MaxHitPoints", from: CORE_B, to: VEF, oldValue: "300", newValue: "400", how: "PatchOperationReplace" },
  { def: "ThingDef/Wall", path: "statBases/MaxHitPoints", from: VEF, to: CE_B, oldValue: "400", newValue: "450", how: "PatchOperationReplace" },
  { def: "ThingDef/Wall", path: "costStuffCount", from: CORE_B, to: RETRO, oldValue: "5", newValue: "4", how: "PatchOperationReplace" },
  { def: "ThingDef/Gun_Autopistol", path: "statBases/AccuracyTouch", from: CORE_W, to: VWE, oldValue: "0.8", newValue: "0.75", how: "PatchOperationReplace" },
  { def: "ThingDef/Gun_Autopistol", path: "statBases/AccuracyTouch", from: VWE, to: CE_W, oldValue: "0.75", newValue: "0.62", how: "PatchOperationReplace" },
  { def: "ThingDef/Gun_Autopistol", path: "verbs/li/burstShotCount", from: CORE_W, to: CE_W, oldValue: "1", newValue: "3", how: "PatchOperationReplace" },
  { def: "ThingDef/Gun_ChargeRifle", path: "statBases/Mass", from: CORE_W, to: CE_W, oldValue: "3.5", newValue: "4.1", how: "PatchOperationReplace" },
  { def: "ThingDef/Bed", path: "costList/Steel", from: CORE_B, to: VFE, oldValue: "40", newValue: "30", how: "Defs" },
  { def: "ThingDef/Bed", path: "costList/Steel", from: VFE, to: DBH, oldValue: "30", newValue: "35", how: "PatchOperationReplace" },
  { def: "ThingDef/AA_Xenoloxodon", path: "statBases/MoveSpeed", from: ALPHA, to: AACE, oldValue: "4.2", newValue: "3.1", how: "PatchOperationReplace" },
  { def: "ThingDef/AA_Xenoloxodon", path: "tools/li[1]/power", from: ALPHA, to: AACE, oldValue: "22", newValue: "18", how: "PatchOperationReplace" },
  { def: "TerrainDef/Concrete", path: "statBases/Beauty", from: CORE_B, to: VEF, oldValue: "0", newValue: "2", how: "PatchOperationReplace" },
  // one value that changed hands many times — the case that has to stay readable
  { def: "ThingDef/Human", path: "statBases/MarketValue", from: CORE_B, to: VEF, oldValue: "1750", newValue: "1800", how: "PatchOperationReplace" },
  { def: "ThingDef/Human", path: "statBases/MarketValue", from: VEF, to: VFE, oldValue: "1800", newValue: "1900", how: "PatchOperationReplace" },
  { def: "ThingDef/Human", path: "statBases/MarketValue", from: VFE, to: ALPHA, oldValue: "1900", newValue: "2000", how: "PatchOperationReplace" },
  { def: "ThingDef/Human", path: "statBases/MarketValue", from: ALPHA, to: DBH, oldValue: "2000", newValue: "2100", how: "PatchOperationReplace" },
  { def: "ThingDef/Human", path: "statBases/MarketValue", from: DBH, to: CE_B, oldValue: "2100", newValue: "2400", how: "PatchOperationReplace" },
  // one mod removing several items of one list — folds into one row
  { def: "ThingDef/Gun_Autopistol", path: "comps/li[1]", from: CORE_W, to: CE_W, oldValue: "CompProperties_Biocodable", newValue: "", how: "PatchOperationRemove" },
  { def: "ThingDef/Gun_Autopistol", path: "comps/li[1]", from: CORE_W, to: CE_W, oldValue: "CompProperties_Styleable", newValue: "", how: "PatchOperationRemove" },
  { def: "ThingDef/Gun_Autopistol", path: "comps/li[1]", from: CORE_W, to: CE_W, oldValue: "CompProperties_Forbiddable", newValue: "", how: "PatchOperationRemove" }
].map((o, i, all) => {
  // node ids the way the backend hands them out: a Replace's successor is the next entry on
  // the same def and path; a Remove has no successor.
  const node = 1000 + i;
  const succ = all.findIndex((x, j) => j > i && x.def === o.def && x.path === o.path && x.from === o.to);
  return { ...o, node, next: o.how === "PatchOperationRemove" ? 0xffffffff : succ >= 0 ? 1000 + succ : node };
});

/** Histories from the journal, the way `defs::flatten::build_chains` makes them. */
function chainsOf(list: typeof OVERWRITES): Chain[] {
  const taken = new Set<number>();
  const out: Chain[] = [];
  const split = (def: string): [string, string] => { const i = def.indexOf("/"); return i < 0 ? [def, ""] : [def.slice(0, i), def.slice(i + 1)]; };
  list.forEach((first, i) => {
    if (taken.has(i)) return;
    taken.add(i);
    const [defType, defName] = split(first.def);
    const steps: ChainStep[] = [{ origin: first.from, value: first.oldValue, how: "Defs" }, { origin: first.to, value: first.newValue, how: first.how }];
    let cur = first;
    for (;;) {
      if (cur.next === 0xffffffff) break;
      const j = list.findIndex((x, k) => k > i && !taken.has(k) && x.node === cur.next);
      if (j < 0) break;
      taken.add(j);
      cur = list[j];
      steps.push({ origin: cur.to, value: cur.newValue, how: cur.how });
    }
    out.push({ def: first.def, defType, defName, path: first.path, steps });
  });
  // fold same-mod removals from one list
  const groups = new Map<string, Chain[]>();
  for (const c of out) {
    const m = c.path.match(/^(.*)\/li(\[\d+\])?$/);
    if (c.steps.length === 2 && c.steps[1].how === "PatchOperationRemove" && m) {
      const key = `${c.def} ${m[1]} ${c.steps[0].origin} ${c.steps[1].origin}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
  }
  const folded: Chain[] = [];
  const absorbed = new Set<Chain>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const m = members[0];
    const list = m.path.replace(/\/li(\[\d+\])?$/, "");
    for (const x of members) absorbed.add(x);
    folded.push({ def: m.def, defType: m.defType, defName: m.defName, path: list, steps: [{ origin: m.steps[0].origin, value: `${members.length} items`, how: "Defs" }, { origin: m.steps[1].origin, value: "", how: "PatchOperationRemove" }], removed: members.map((x) => x.steps[0].value) });
  }
  for (const c of out) if (!absorbed.has(c)) folded.push(c);
  return folded.sort((a, b) => b.steps.length - a.steps.length || (b.removed?.length ?? 0) - (a.removed?.length ?? 0) || a.def.localeCompare(b.def) || a.path.localeCompare(b.path));
}

const PROBLEMS = [
  { origin: CE_W, xpath: 'Defs/ThingDef[defName="Gun_Revolver"]/verbs/li/burstShotCount', class: "PatchOperationReplace", reason: "nothing in the list matches this xpath", tolerated: false },
  { origin: CE_W, xpath: 'Defs/ThingDef[defName="Gun_SniperRifle"]/tools', class: "PatchOperationRemove", reason: "nothing in the list matches this xpath", tolerated: false },
  { origin: AACE, xpath: 'Defs/ThingDef[defName="AA_Diredwarf"]/statBases/ArmorRating_Sharp', class: "PatchOperationReplace", reason: "nothing in the list matches this xpath", tolerated: false },
  { origin: DBH, xpath: 'Defs/ThingDef[defName="VFE_Washbasin"]', class: "PatchOperationAdd", reason: "nothing in the list matches this xpath", tolerated: false },
  { origin: RETRO, xpath: "", class: "Patch", reason: "the file's root element is <Defs>, not <Patch>, so the game ignores it", tolerated: false },
  { origin: DBH, xpath: 'Defs/ThingDef[defName=="Bed"]/costList', class: "PatchOperationReplace", reason: "the xpath does not parse: unexpected '=' at 30", tolerated: false },
  { origin: CE_B, xpath: 'Defs/ThingDef[defName="Wall"]/graphicData/damageData', class: "PatchOperationRemove", reason: "nothing in the list matches this xpath", tolerated: true },
  { origin: VWE, xpath: 'Defs/ThingDef[defName="Gun_Autopistol"]/weaponTags/CE_Sidearm', class: "PatchOperationRemove", reason: "nothing in the list matches this xpath", tolerated: true },
  { origin: XML, xpath: "Defs", class: "XmlExtensions.PatchOperationSafeAdd", reason: "Circinus does not know this operation, so its effect is not in this view", tolerated: true },
  { origin: XML, xpath: 'Defs/ThingDef[defName="Wall"]', class: "XmlExtensions.PatchOperationFindMod", reason: "Circinus does not know this operation, so its effect is not in this view", tolerated: true }
];

const DUPLICATES = [
  { defType: "ThingDef", defName: "Bed", origins: [CORE_B, VFE], winner: VFE },
  { defType: "ThingDef", defName: "Gun_Autopistol", origins: [CORE_W, VWE], winner: VWE },
  { defType: "TerrainDef", defName: "Concrete", origins: [CORE_B, VEF], winner: VEF }
];

/** [tag, value, depth, origin, inheritedFrom, Class] — inheritedFrom empty when the def wrote it. */
type MockNode = [string, string, number, number, string, string?];
const DEF_TREES: Record<string, { origin: number; nodes: MockNode[] }> = {
  "ThingDef/Wall": {
    origin: CORE_B,
    nodes: [
      ["defName", "Wall", 0, CORE_B, ""],
      ["label", "wall", 0, CORE_B, ""],
      ["description", "A wall used to block passage and provide a roof support.", 0, CORE_B, ""],
      ["thingClass", "Building", 0, CORE_B, "BuildingBase"],
      ["category", "Building", 0, CORE_B, "BuildingBase"],
      ["statBases", "", 0, CORE_B, ""],
      ["MaxHitPoints", "450", 1, CE_B, ""],
      ["WorkToBuild", "135", 1, CORE_B, ""],
      ["Flammability", "1.0", 1, CORE_B, "BuildingBase"],
      ["Beauty", "2", 1, VEF, ""],
      ["costStuffCount", "4", 0, RETRO, ""],
      ["graphicData", "", 0, CORE_B, ""],
      ["texPath", "Things/Building/Linked/Wall_Atlas", 1, RETRO, ""],
      ["graphicClass", "Graphic_Appearances", 1, CORE_B, ""],
      ["comps", "", 0, CORE_B, ""],
      ["li", "", 1, CORE_B, "", "CompProperties_Forbiddable"],
      ["li", "", 1, VEF, "", "VEF.CompProperties_Glower"],
      ["building", "", 0, CORE_B, ""],
      ["isInert", "true", 1, CORE_B, "BuildingBase"],
      ["blueprintGraphicData", "", 1, CORE_B, ""],
      ["texPath", "Things/Building/Linked/Wall_Blueprint_Atlas", 2, CORE_B, ""]
    ]
  },
  "ThingDef/Gun_Autopistol": {
    origin: VWE,
    nodes: [
      ["defName", "Gun_Autopistol", 0, VWE, ""],
      ["label", "autopistol", 0, VWE, ""],
      ["statBases", "", 0, VWE, ""],
      ["AccuracyTouch", "0.62", 1, CE_W, ""],
      ["AccuracyShort", "0.55", 1, VWE, ""],
      ["Mass", "1.4", 1, VWE, "BaseHumanMakeableGun"],
      ["verbs", "", 0, VWE, ""],
      ["li", "", 1, VWE, ""],
      ["burstShotCount", "3", 2, CE_W, ""],
      ["range", "22", 2, VWE, ""],
      ["weaponTags", "", 0, VWE, ""],
      ["li", "SimpleGun", 1, VWE, ""],
      ["li", "CE_Sidearm", 1, CE_W, ""]
    ]
  },
  "ThingDef/Bed": {
    origin: VFE,
    nodes: [
      ["defName", "Bed", 0, VFE, ""],
      ["label", "bed", 0, VFE, ""],
      ["costList", "", 0, VFE, ""],
      ["Steel", "35", 1, DBH, ""],
      ["Cloth", "20", 1, VFE, ""],
      ["statBases", "", 0, VFE, ""],
      ["Comfort", "0.75", 1, VFE, "BedBase"],
      ["WorkToBuild", "800", 1, VFE, "BedBase"]
    ]
  },
  "ThingDef/AA_Xenoloxodon": {
    origin: ALPHA,
    nodes: [
      ["defName", "AA_Xenoloxodon", 0, ALPHA, ""],
      ["label", "xenoloxodon", 0, ALPHA, ""],
      ["statBases", "", 0, ALPHA, ""],
      ["MoveSpeed", "3.1", 1, AACE, ""],
      ["MarketValue", "1800", 1, ALPHA, ""],
      ["tools", "", 0, ALPHA, ""],
      ["li", "", 1, ALPHA, ""],
      ["power", "18", 2, AACE, ""],
      ["capacities", "", 2, ALPHA, ""]
    ]
  },
  "TerrainDef/Concrete": {
    origin: VEF,
    nodes: [
      ["defName", "Concrete", 0, VEF, ""],
      ["label", "concrete", 0, VEF, ""],
      ["statBases", "", 0, VEF, ""],
      ["Beauty", "2", 1, VEF, ""],
      ["Cleanliness", "0.05", 1, VEF, "FloorBase"]
    ]
  },
  "ThingDef/Gun_ChargeRifle": {
    origin: CORE_W,
    nodes: [
      ["defName", "Gun_ChargeRifle", 0, CORE_W, ""],
      ["label", "charge rifle", 0, CORE_W, ""],
      ["statBases", "", 0, CORE_W, ""],
      ["Mass", "4.1", 1, CE_W, ""]
    ]
  },
  "ThingDef/Wall_Sandstone": {
    origin: CORE_B,
    nodes: [
      ["defName", "Wall_Sandstone", 0, CORE_B, ""],
      ["label", "sandstone wall", 0, CORE_B, ""],
      ["statBases", "", 0, CORE_B, ""],
      ["MaxHitPoints", "300", 1, CORE_B, "BuildingBase"]
    ]
  }
};

function defTree(defType: string, defName: string) {
  const t = DEF_TREES[`${defType}/${defName}`];
  if (!t) return null;
  const stack: string[] = [];
  const nodes = t.nodes.map(([tag, value, depth, origin, from, cls], i) => {
    stack.length = depth;
    stack[depth] = tag;
    const next = t.nodes[i + 1];
    return {
      tag,
      path: stack.slice(0, depth + 1).join("/"),
      value,
      // A node is a leaf when nothing deeper follows it.
      leaf: !next || next[2] <= depth,
      depth,
      origin,
      inherited: !!from,
      inheritedFrom: from,
      attrs: (cls ? [["Class", cls]] : []) as [string, string][]
    };
  });
  return { defType, defName, origin: t.origin, nodes, truncated: 0 };
}

/** Every def name the mock knows, for the search box. */
const DEF_INDEX = Object.entries(DEF_TREES).map(([label, t]) => {
  const at = label.indexOf("/");
  return { def: label, defType: label.slice(0, at), defName: label.slice(at + 1), origin: t.origin };
});

function defsQuery(xpath: string, limit: number) {
  const literals = [...xpath.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  const started = performance.now();
  let matches: { def: string; defType: string; defName: string; path: string; value: string; origin: number; inherited: boolean }[] = [];
  if (xpath.includes("contains(") && xpath.includes("defName")) {
    // The search box: defs whose name contains the text.
    const q = (literals[literals.length - 1] ?? "").toLowerCase();
    matches = DEF_INDEX.filter((d) => d.defName.toLowerCase().includes(q)).map((d) => ({ ...d, path: "defName", value: d.defName, inherited: false }));
  } else {
    // Anything else: the node whose path within its def matches the tail of the xpath.
    const wanted = (literals[0] ?? "").toLowerCase();
    const steps = xpath.replace(/\[[^\]]*\]/g, "").split("/").filter((s) => s && s !== "Defs");
    const tail = steps.slice(1).join("/");
    for (const d of DEF_INDEX) {
      if (wanted && !d.defName.toLowerCase().includes(wanted)) continue;
      if (steps[0] && steps[0] !== "*" && steps[0] !== d.defType) continue;
      const tree = defTree(d.defType, d.defName)!;
      for (const n of tree.nodes) {
        if (!tail || n.path === tail || n.path.endsWith(`/${tail}`) || n.tag === steps[steps.length - 1]) {
          matches.push({ def: d.def, defType: d.defType, defName: d.defName, path: n.path, value: n.value, origin: n.origin, inherited: n.inherited });
        }
      }
    }
  }
  return { total: matches.length, matches: matches.slice(0, limit), elapsedMs: Math.round(performance.now() - started) };
}

function defsReport() {
  const origins = defsOrigins();
  const byUid = new Map<string, { uid: string; name: string; defs: number; values: number; wins: number; losses: number; operations: number; failedOperations: number }>();
  for (const o of origins.slice(1)) {
    if (!byUid.has(o.uid)) byUid.set(o.uid, { uid: o.uid, name: o.name, defs: 0, values: 0, wins: 0, losses: 0, operations: 0, failedOperations: 0 });
  }
  const stat = (origin: number) => byUid.get(origins[origin]?.uid ?? "");
  for (const [i, o] of origins.entries()) {
    const s = stat(i);
    if (!s) continue;
    // The game ships the most, then the frameworks, then the content mods; patch mods ship none.
    if (o.isPatch) s.operations += 40 + i * 7;
    else {
      s.defs += Math.max(80, 900 - i * 110);
      s.values += Math.max(600, 7200 - i * 880);
    }
  }
  for (const w of OVERWRITES) {
    const to = stat(w.to), from = stat(w.from);
    if (to) to.wins++;
    if (from) from.losses++;
  }
  for (const p of PROBLEMS) {
    const s = stat(p.origin);
    if (s && !p.tolerated) s.failedOperations++;
  }
  const perMod = [...byUid.values()].sort((a, b) => b.values - a.values || a.name.localeCompare(b.name));
  return {
    origins,
    defs: perMod.reduce((n, m) => n + m.defs, 0),
    values: perMod.reduce((n, m) => n + m.values, 0),
    operations: perMod.reduce((n, m) => n + m.operations, 0),
    overwrites: OVERWRITES,
    chains: chainsOf(OVERWRITES),
    problems: PROBLEMS,
    duplicates: DUPLICATES,
    perMod,
    missingParents: [
      "ThingDef/AA_Diredwarf asks for a parent called AA_AnimalThingBase, which nothing defines",
      "ThingDef/DBH_ShowerBase inherits from itself",
      "RecipeDef/Make_Beer asks for a parent called DrinkRecipeBase, which nothing defines"
    ],
    elapsedMs: 8420
  };
}

let defsState: import("./types").DefsState = { running: false, phase: "idle", done: 0, total: 0, current: "", startedAt: 0, finishedAt: 0, stopped: false, error: null, report: null };
/** The Steam client as the preview pretends it is: running, unless the page asks for ?nosteam. */
function steamClient() {
  const running = !(typeof location !== "undefined" && location.search.includes("nosteam"));
  return {
    installed: true,
    running,
    steamDir: "C:\\Program Files (x86)\\Steam",
    recordsFound: true,
    detail: running ? "Steam is running, so a Workshop link opens straight away." : "Steam is installed but not running. Opening a Workshop link starts it, which takes a moment."
  };
}

/** Workshop mods in the example data came from a subscription; SteamCMD ones did not. */
function subState(id: number): "subscribed" | "installed" | "absent" {
  const seed = SEED.find((s) => Number(s[3]) === id);
  if (!seed) return "absent";
  return seed[4] === "workshop" ? "subscribed" : seed[4] === "steamcmd" || seed[4] === "local" ? "installed" : "absent";
}

// ---- events ----
// Tauri's backend pushes progress as events; in the browser the mock plays that part for the
// jobs that need it. `listen` is what api.ts hands the store outside Tauri.
const listeners = new Map<string, Set<(payload: unknown) => void>>();
export function listen(event: string, handler: (payload: unknown) => void): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}
function emit(event: string, payload: unknown) {
  for (const h of listeners.get(event) ?? []) h(payload);
}

// ---- a newer Circinus ----
// `?update` makes the feed offer 0.2.0; Install animates a download, then says it relaunched.
const updateOffered = typeof location !== "undefined" && location.search.includes("update");
const MOCK_VERSION = "0.1.0";
const MOCK_UPDATE = { available: true, current: MOCK_VERSION, version: "0.2.0", notes: "HALO learns late loaders. The Patches view names who else patches the same method. Fixes for linked mod folders.", pubDate: "2026-09-05T18:00:00Z" };
let updateInstalled = false;
function installUpdate(): Promise<void> {
  const total = 48_300_000;
  let downloaded = 0;
  return new Promise((resolve) => {
    const tick = () => {
      downloaded = Math.min(total, downloaded + 2_400_000);
      emit("update-progress", { phase: "downloading", version: "0.2.0", downloaded, total, error: null });
      if (downloaded < total) return setTimeout(tick, 80);
      emit("update-progress", { phase: "installing", version: "0.2.0", downloaded, total, error: null });
      setTimeout(() => {
        emit("update-progress", { phase: "restarting", version: "0.2.0", downloaded, total, error: null });
        updateInstalled = true;
        // The real command never returns on success: the process is replaced. The mock
        // resolves so the page keeps working, with the banner saying what would have happened.
        resolve();
      }, 700);
    };
    setTimeout(tick, 80);
  });
}
if (updateOffered) setTimeout(() => emit("update-available", MOCK_UPDATE), 1500);

export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 30));
  const A = args as Record<string, any>;
  // Load testing: a page may provide a full backend snapshot (see src-tauri/examples/dump_snapshot.rs).
  const fixture = (globalThis as any).__CIRCINUS_FIXTURE__ as Snapshot | undefined;
  switch (cmd) {
    case "set_incompatibility_hidden":
    case "clear_hidden_warnings":
      // The mock has no backend to remember it; the button still proves it is reachable.
      return (cmd === "clear_hidden_warnings" ? [0, snapshot()] : snapshot()) as T;
    case "log_from_the_window":
      console.error("[circinus mock] the window would have logged:", A.message, A.stack ?? "");
      return undefined as T;
    case "diagnostics":
      return [
        "Circinus Mod Manager 0.0.0 (mock)",
        `${navigator.platform} in a browser`,
        "",
        "This is the browser mock, so there are no folders and no log to read.",
        "The real report carries the version, the platform, every folder and whether it is",
        "there, what the scan found, and the tail of the log with the home directory hidden."
      ].join("\n") as T;
    // ?crash=1 hands back a snapshot whose mods cannot be read, which is what a bad value in the
    // store looks like from the window's point of view. It exists so the error boundary can be
    // tested rather than assumed: the difference between a message and a black window is not
    // something to find out from a user.
    case "get_snapshot": {
      if (typeof location !== "undefined" && /[?&]crash=1/.test(location.search)) {
        // A field that is simply not there, which is what a backend and a window that disagree
        // about the shape actually produce: an old build talking to a new one, or a serialisation
        // that dropped something. A snapshot missing `settings` used to reach a `$derived` and
        // take the whole window down with an error from inside the framework.
        const bad: any = { ...(fixture ?? snapshot()) };
        delete bad.settings;
        return bad as T;
      }
    }
    // falls through to the normal snapshot
    // eslint-disable-next-line no-fallthrough
    case "__snapshot":
    case "rescan":
      return (fixture ?? snapshot()) as T;
    case "set_active":
      active = (A.uids as string[]).filter((u, i, arr) => arr.indexOf(u) === i && mods.some((m) => m.uid === u));
      dirty = true;
      return snapshot() as T;
    case "activate": {
      const add = (A.uids as string[]).filter((u) => !active.includes(u));
      const at = A.at as number | null;
      if (at == null || at > active.length) active = [...active, ...add];
      else active = [...active.slice(0, at), ...add, ...active.slice(at)];
      dirty = true;
      return snapshot() as T;
    }
    case "deactivate":
      active = active.filter((u) => !(A.uids as string[]).includes(u));
      dirty = true;
      return snapshot() as T;
    case "halo": {
      const r = haloSort();
      if (A.apply) { active = r.order; dirty = true; }
      return r as T;
    }
    case "validate":
      return issues(active) as T;
    case "save_mods_config":
      dirty = false;
      return settings.locations.configDir + "\\ModsConfig.xml" as T;
    case "import_list": {
      const text = (A.text as string) ?? "";
      const ids = Array.from(text.matchAll(/\[([a-z0-9._-]+\.[a-z0-9._-]+)\]/gi)).map((m) => m[1].toLowerCase());
      const list = ids.length ? ids : text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l.includes("."));
      const uids = list.map((id) => mods.find((m) => m.packageId === id)?.uid).filter(Boolean) as string[];
      const missing = list.filter((id) => !mods.some((m) => m.packageId === id));
      return { list: { packageIds: list, format: "Text list" }, uids, missing } as T;
    }
    case "apply_import":
      if (A.append) active = [...active, ...(A.uids as string[]).filter((u) => !active.includes(u))];
      else active = A.uids as string[];
      dirty = true;
      return snapshot() as T;
    case "update_settings": {
      settings = A.settings as Settings;
      // Settings edits the instance that is open, the way the backend does it.
      const inst = instances.find((i) => i.id === current)!;
      inst.locations = settings.locations;
      inst.launch = settings.launch;
      return snapshot() as T;
    }
    case "autodetect_locations":
      return settings.locations as T;
    case "update_user":
      user = A.user as UserData;
      return snapshot() as T;
    case "update_databases":
      return ["Community rules (RimSort): updated", "Steam Workshop database (RimSort): already current", "Use This Instead (emipa606, MIT): updated", "No Version Warning (emipa606, MIT): updated"] as T;
    case "refresh_weights":
      return Object.keys(weights).length as T;
    case "refresh_local_weights":
      return 0 as T;
    case "get_files":
      return { textures: [], patches: [], defs: [], assemblies: [] } as T;
    case "get_user_rules":
      return { timestamp: 0, rules: rules.filter((r) => r.source === "user"), ignore: [] } as T;
    case "edit_user_rule":
      return snapshot() as T;
    case "get_description":
      return (mods.find((m) => m.uid === A.uid)?.description ?? "") as T;
    case "downloads_state":
    case "downloads_remove":
    case "downloads_clear_finished":
    case "downloads_pause": {
      // ?nosteamcmd shows the first-run state in the browser preview.
      const bare = typeof location !== "undefined" && location.search.includes("nosteamcmd");
      const q = structuredClone(queue) as unknown as QueueState;
      return (bare ? { ...q, items: [], running: false, currentBatch: [], currentItem: null, steamcmdInstalled: false, log: [] } : q) as T;
    }
    case "downloads_add":
    case "downloads_update":
    case "downloads_add_text":
      return { added: 2, skipped: [[1, "not a RimWorld workshop item"]] } as T;
    case "downloads_add_missing":
      return [{ added: 1, skipped: [] }, ["some.missing.mod"]] as T;
    case "downloads_retry_failed":
      return 1 as T;
    case "steamcmd_install":
      return undefined as T;
    case "steamcmd_status":
      return { installed: !(typeof location !== "undefined" && location.search.includes("nosteamcmd")), installing: false, root: "C:\\Users\\Player\\AppData\\Local\\Circinus\\steamcmd", exe: "C:\\Users\\Player\\AppData\\Local\\Circinus\\steamcmd\\steamcmd\\steamcmd.exe", downloadsDir: "C:\\Users\\Player\\AppData\\Local\\Circinus\\steamcmd\\steam\\steamapps\\workshop\\content\\294100", consoleLog: "C:\\Users\\Player\\AppData\\Local\\Circinus\\steamcmd\\steamcmd\\logs\\console_log.txt", consoleLogBytes: 48211, modsDir: "C:\\RimWorld\\Mods", workshopDir: "C:\\Steam\\steamapps\\workshop\\content\\294100", queued: 3, running: true, paused: false, batchSize: 12, cooldownUntil: null } as T;
    case "steamcmd_test":
      return { loggedIn: true, lines: 14, stalled: false, exitCode: 0, seconds: 4 } as T;
    // Subscriptions: ?nosteam pretends the client is not running, the other honest case.
    case "steam_client_status":
      return steamClient() as T;
    case "subscription_state":
      return (A.ids as number[]).map((id) => ({ id, state: subState(id), timeUpdated: subState(id) === "subscribed" ? 1_756_500_000 : undefined })) as T;
    case "missing_workshop_ids":
      return [[999], ["some.missing.mod"]] as T;
    case "subscribe_items":
    case "unsubscribe_items": {
      const ids = A.ids as number[];
      const client = steamClient();
      const sub = cmd === "subscribe_items";
      const open = ids.filter((id) => (sub ? subState(id) !== "subscribed" : subState(id) === "subscribed")).slice(0, 8);
      const skipped: [number, string][] = ids.filter((id) => !open.includes(id)).map((id) => [id, sub ? "Steam already has this one" : "Steam does not list this one, so there is nothing to unsubscribe from"]);
      const pages = open.length === 1 ? "the page" : `${open.length} pages`;
      const start = client.running ? "" : "Steam is not running, so it starts first. ";
      const note = open.length
        ? sub
          ? `${start}Steam has been asked for ${pages}. Press Subscribe on each; the mod appears here once Steam has downloaded it.`
          : `${start}Steam has been asked for ${pages}. Press Unsubscribe on each; Steam then deletes the mod's folder.`
        : "Nothing to open.";
      return { opened: open, skipped, failed: [], note, client, states: ids.map((id) => ({ id, state: subState(id) })) } as T;
    }
    case "acknowledge_changes":
      acknowledged = true;
      return snapshot() as T;
    case "saved_lists":
      return savedLists as T;
    case "restore_list":
      dirty = !A.save;
      return { snapshot: snapshot(), restored: 44, missing: [] } as T;
    case "save_named_list": {
      const name = (A.name as string).trim();
      if (!name) throw new Error("Give the list a name");
      const existing = namedLists().find((l) => l.name === name);
      if (existing) { existing.uids = [...active]; existing.updatedAt = Math.floor(Date.now() / 1000); }
      else namedLists().unshift({ name, uids: [...active], updatedAt: Math.floor(Date.now() / 1000) });
      setCurrentList(name);
      return snapshot() as T;
    }
    case "load_named_list": {
      const l = namedLists().find((l) => l.name === A.name);
      if (!l) throw new Error(`No list called ${A.name}`);
      active = [...l.uids];
      dirty = true;
      setCurrentList(l.name);
      return { snapshot: snapshot(), restored: l.uids.length, missing: [] } as T;
    }
    case "delete_named_list":
      listsPerInstance[current] = namedLists().filter((l) => l.name !== A.name);
      if (currentList() === A.name) setCurrentList(null);
      return snapshot() as T;
    case "rename_named_list": {
      const l = namedLists().find((l) => l.name === A.from);
      if (!l) throw new Error(`No list called ${A.from}`);
      if (namedLists().some((x) => x.name === A.to)) throw new Error(`There is already a list called ${A.to}`);
      l.name = A.to as string;
      if (currentList() === A.from) setCurrentList(l.name);
      return snapshot() as T;
    }
    case "detach_list":
      setCurrentList(null);
      return snapshot() as T;
    case "delete_mod": {
      const m = mods.find((m) => m.uid === A.uid);
      if (!m) throw new Error("No such mod");
      if (m.source === "workshop") throw new Error("Steam owns this folder: unsubscribe on the Workshop page and Steam removes it");
      mods.splice(mods.indexOf(m), 1);
      if (active.includes(m.uid)) { active = active.filter((u) => u !== m.uid); dirty = true; }
      return [snapshot(), m.linkTarget ? `Removed the link ${m.path.split("\\").pop()}; the folder it pointed at is untouched` : `Moved ${m.path.split("\\").pop()} to the recycle bin`] as T;
    }
    case "localize_mod": {
      const m = mods.find((m) => m.uid === A.uid);
      if (!m) throw new Error("No such mod");
      if (m.source !== "workshop") throw new Error(`${m.name} is not a Steam Workshop mod, so there is nothing to copy: it is already on your disk to keep`);
      const uid = `C:\\Mods\\${m.publishedFileId}`;
      if (mods.some((x) => x.uid === uid)) throw new Error(`There is already a folder called ${m.publishedFileId} in Mods. Nothing was copied; look at it before deciding what to do with it`);
      const copy: ModInfo = { ...structuredClone(m), uid, path: uid, source: "steamcmd" };
      mods.push(copy);
      // byUid is built once at module load, and `placements` looks every active uid up in it
      // without a guard. A mod that appears later has to be put there too.
      byUid.set(uid, copy);
      const at = active.indexOf(m.uid);
      if (at >= 0) { active[at] = uid; dirty = true; }
      return [snapshot(), `Copied 214 files (18 MB) to ${m.publishedFileId} in C:\\Mods, and your list now loads that copy. Steam's copy stays subscribed and updated; it just is not the one the game reads.`] as T;
    }
    case "collection_track": {
      const id = Number(String(A.text).match(/\d{6,}/)?.[0]);
      if (!id) throw new Error("No Workshop link or id found");
      if ((user.collections ?? []).some((c) => c.id === id)) throw new Error("You already follow that collection");
      const items = SEED.filter((s) => s[3]).slice(0, 12).map((s) => Number(s[3]));
      const names = Object.fromEntries(SEED.filter((s) => s[3]).slice(0, 12).map((s) => [s[3], s[0]]));
      user.collections = [...(user.collections ?? []), { id, name: `Collection ${id}`, creator: "Someone", items, known: items, names, checkedAt: Math.floor(Date.now() / 1000), addedAt: Math.floor(Date.now() / 1000), timeUpdated: 1_756_000_000 }];
      return snapshot() as T;
    }
    case "collection_refresh":
      for (const c of user.collections ?? []) {
        if (A.id != null && c.id !== A.id) continue;
        c.checkedAt = Math.floor(Date.now() / 1000);
        // pretend the author added one mod and dropped another
        const extra = Number(SEED[SEED.length - 1][3]);
        if (!c.items.includes(extra)) { c.items = [...c.items.slice(1), extra]; c.names[String(extra)] = SEED[SEED.length - 1][0]; }
      }
      return snapshot() as T;
    case "collection_acknowledge":
      for (const c of user.collections ?? []) if (c.id === A.id) c.known = [...c.items];
      return snapshot() as T;
    case "collection_untrack":
      user.collections = (user.collections ?? []).filter((c) => c.id !== A.id);
      return snapshot() as T;
    case "announcements_refresh":
      packsCheckedAt = Math.floor(Date.now() / 1000);
      return snapshot() as T;
    case "announcements_seen": {
      const at = Number(A.at);
      const pack = String(A.pack);
      user.packsRead = { ...(user.packsRead ?? {}), [pack]: Math.max(at, user.packsRead?.[pack] ?? 0) };
      return snapshot() as T;
    }
    case "announcements_mute": {
      const set = new Set(user.packsMuted ?? []);
      if (A.muted) set.add(Number(A.pack));
      else set.delete(Number(A.pack));
      user.packsMuted = [...set];
      return snapshot() as T;
    }
    case "get_launch_info": {
      const args = mockLaunchArgs();
      return { executable: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld\\RimWorldWin64.exe", executableExists: true, steamInstall: true, autoResolvesTo: "steam", args, saveDataFolder: mockSaveDataFolder() } as T;
    }
    // ---- instances ----
    case "instances_list":
      return instances as T;
    case "instance_current":
      return instances.find((i) => i.id === current)! as T;
    case "instance_create": {
      const name = String(A.name ?? "").trim();
      if (!name) throw new Error("Give the instance a name of up to 80 characters");
      const inst: Instance = { id: `${slug(name)}-${Math.random().toString(16).slice(2, 7)}`, name, locations: A.fromCurrent ? { ...settings.locations } : {}, launch: A.fromCurrent ? { ...settings.launch } : { ...launchDefaults }, createdAt: Math.floor(Date.now() / 1000) };
      instances.push(inst);
      listsPerInstance[inst.id] = [];
      currentListPerInstance[inst.id] = null;
      return inst as T;
    }
    case "instance_duplicate": {
      const src = instances.find((i) => i.id === A.id);
      if (!src) throw new Error("No such instance");
      const name = String(A.name ?? `${src.name} copy`);
      const inst: Instance = { ...src, id: `${slug(name)}-${Math.random().toString(16).slice(2, 7)}`, name, locations: { ...src.locations }, launch: { ...src.launch }, createdAt: Math.floor(Date.now() / 1000) };
      instances.push(inst);
      listsPerInstance[inst.id] = [];
      currentListPerInstance[inst.id] = null;
      return inst as T;
    }
    case "instance_rename": {
      const inst = instances.find((i) => i.id === A.id);
      if (!inst) throw new Error("No such instance");
      const name = String(A.name ?? "").trim();
      if (!name) throw new Error("Give the instance a name of up to 80 characters");
      inst.name = name;
      return inst as T;
    }
    case "instance_update": {
      const inst = instances.find((i) => i.id === A.id);
      if (!inst) throw new Error("No such instance");
      inst.locations = A.locations as Locations;
      inst.launch = A.launch as LaunchSettings;
      if (inst.id === current) settings = { ...settings, locations: inst.locations, launch: inst.launch };
      return inst as T;
    }
    case "instance_delete": {
      const inst = instances.find((i) => i.id === A.id);
      if (!inst) throw new Error("No such instance");
      if (instances.length < 2) throw new Error("This is the only instance. Make another one first.");
      instances.splice(instances.indexOf(inst), 1);
      if (current === inst.id) current = instances[0].id;
      settings = { ...settings, locations: instances.find((i) => i.id === current)!.locations, launch: instances.find((i) => i.id === current)!.launch };
      return `Forgot the instance ${inst.name}. Its mods, saves and config folder are where they were.` as T;
    }
    case "instance_switch": {
      const inst = instances.find((i) => i.id === A.id);
      if (!inst) throw new Error("No such instance");
      if (dirty && !A.discard) throw new Error("The list has unsaved changes. Save it first, or switch and lose them.");
      current = inst.id;
      dirty = false;
      // The real backend re-scans the new folders; the mock keeps one set of mods and only
      // moves the folders, the named lists and the list being worked on.
      settings = { ...settings, locations: inst.locations, launch: inst.launch };
      const list = namedLists().find((l) => l.name === currentList());
      if (list) active = [...list.uids];
      return inst as T;
    }
    case "launch_game":
      dirty = false;
      return "Asked Steam to start RimWorld (mock)" as T;
    case "player_log_paths":
      return [
        { path: "C:\\Users\\Player\\AppData\\LocalLow\\Ludeon Studios\\RimWorld by Ludeon Studios\\Player.log", exists: true, bytes: 3301258, modified: 1757016000 },
        { path: "C:\\Users\\Player\\AppData\\LocalLow\\Ludeon Studios\\RimWorld by Ludeon Studios\\Player-prev.log", exists: true, bytes: 812000, modified: 1756930000 }
      ] as T;
    case "analyze_player_log":
      return mockLogAnalysis((A.path as string | null) ?? "C:\\Users\\Player\\AppData\\LocalLow\\Ludeon Studios\\RimWorld by Ludeon Studios\\Player.log") as T;
    case "halo_rules":
      return HALO_RULES as T;
    case "dds_state":
      return structuredClone(tex) as T;
    case "dds_overview":
      return mods.filter((m) => m.source !== "ludeon" && m.contents.textures + m.contents.dds > 0).map((m) => ({ uid: m.uid, name: m.name, active: active.includes(m.uid), pngs: m.contents.textures, dds: m.contents.dds + (ddsIndex[m.uid]?.count ?? 0), converted: ddsIndex[m.uid]?.count ?? 0, ddsBytes: ddsIndex[m.uid]?.ddsBytes ?? 0, pngBytes: ddsIndex[m.uid]?.pngBytes ?? 0, excluded: user.ddsExcluded.includes(m.uid) })).sort((a, b) => b.pngs - a.pngs) as T;
    case "dds_start": {
      // Simulate a short job: mark the mods converted after a moment.
      const uids = A.uids as string[];
      const total = uids.reduce((n, u) => n + (mods.find((m) => m.uid === u)?.contents.textures ?? 0), 0);
      tex = { ...tex, running: true, phase: "converting", startedAt: Math.floor(Date.now() / 1000), progress: { total, done: Math.floor(total / 3), converted: Math.floor(total / 3), failed: 0, pngBytes: total * 20_000, ddsBytes: total * 14_000, current: "Textures/Things/Building/Wall_Atlas.png" }, errors: [] };
      setTimeout(() => {
        for (const u of uids) { const m = mods.find((x) => x.uid === u); if (m) ddsIndex[u] = { count: m.contents.textures, ddsBytes: m.contents.textures * 42_000, pngBytes: m.contents.textures * 60_000, vramBefore: m.contents.textures * 350_000, newest: Math.floor(Date.now() / 1000) }; }
        tex = { ...tex, running: false, phase: "idle", finishedAt: Math.floor(Date.now() / 1000), report: { kind: "convert", mods: uids.length, converted: total, failed: 0, current: 0, shipped: 2, pngBytes: total * 60_000, ddsBytes: total * 42_000, seconds: 3, cancelled: false, reverted: 0, bytesFreed: 0 } };
      }, 1500);
      return undefined as T;
    }
    case "dds_cancel":
      return undefined as T;
    case "dds_revert": {
      // A background job like a conversion: progress first, the report a moment later.
      const uids = A.uids as string[];
      const total = uids.reduce((n, u) => n + (ddsIndex[u]?.count ?? 0), 0);
      tex = { ...tex, running: true, phase: "reverting", startedAt: Math.floor(Date.now() / 1000), progress: { total, done: Math.floor(total / 2), converted: 0, failed: 0, pngBytes: 0, ddsBytes: 0, current: mods.find((m) => m.uid === uids[0])?.name ?? "" }, errors: [] };
      setTimeout(() => {
        let n = 0, b = 0;
        for (const u of uids) { if (ddsIndex[u]) { n += ddsIndex[u].count; b += ddsIndex[u].ddsBytes; delete ddsIndex[u]; } }
        tex = { ...tex, running: false, phase: "idle", finishedAt: Math.floor(Date.now() / 1000), progress: { ...tex.progress, done: total }, report: { kind: "revert", mods: uids.length, converted: 0, failed: 0, current: 0, shipped: 0, pngBytes: 0, ddsBytes: 0, seconds: 1, cancelled: false, reverted: n, bytesFreed: b } };
      }, 1200);
      return undefined as T;
    }
    case "dds_audit": {
      const uids = A.uids as string[];
      const pick = uids.filter((u) => ["vanillaexpanded.vtexe", "nyx.retrowalls"].includes(mods.find((m) => m.uid === u)?.packageId ?? "")).slice(0, 2);
      const findings = (i: number) => [
        { rel: `Textures/UI/Backgrounds/Path${i}.dds`, width: 1022, height: 574, format: "BC7", levels: 1, bytes: 587776, problem: { kind: "notMultipleOf4" }, hasPng: true, fixable: true },
        { rel: `Textures/Things/_Old/Elk_${i}_east.dds`, width: 130, height: 130, format: "DXT1", levels: 8, bytes: 11576, problem: { kind: "notMultipleOf4" }, hasPng: false, fixable: true },
        { rel: `Textures/Things/Broken${i}.dds`, width: 256, height: 256, format: "BC5", levels: 1, bytes: 30000, problem: { kind: "truncated", expected: 65684, actual: 30000 }, hasPng: false, fixable: false }
      ];
      const list = pick.map((u, i) => ({ uid: u, name: mods.find((m) => m.uid === u)!.name, active: active.includes(u), findings: findings(i) }));
      return { modsChecked: uids.length, mods: list, files: list.reduce((n, m) => n + m.findings.length, 0), fixable: list.reduce((n, m) => n + m.findings.filter((f) => f.fixable).length, 0), seconds: 2 } as T;
    }
    case "dds_fix": {
      const targets = A.targets as [string, string[]][];
      const fixed = targets.length * 2;
      tex = { ...tex, report: { mods: targets.length, converted: 0, failed: 0, current: 0, shipped: 0, pngBytes: 0, ddsBytes: fixed * 400000, seconds: 3, cancelled: false, reverted: 0, bytesFreed: 0, fixed } };
      return tex.report as T;
    }
    case "defs_start": {
      const total = active.length * 2;
      defsState = { running: true, phase: "defs", done: 0, total, current: mods.find((m) => m.uid === active[0])?.name ?? "", startedAt: Math.floor(Date.now() / 1000), finishedAt: 0, stopped: false, error: null, report: null };
      setTimeout(() => {
        if (!defsState.running) return;
        defsState = { ...defsState, phase: "patches", done: Math.floor(total * 0.6), current: "Combat Extended" };
      }, 400);
      setTimeout(() => {
        if (!defsState.running) return;
        defsState = { ...defsState, running: false, phase: "idle", done: total, current: "", finishedAt: Math.floor(Date.now() / 1000), report: defsReport() };
      }, 1100);
      return undefined as T;
    }
    case "defs_status":
      return structuredClone(defsState) as T;
    case "defs_stop":
      if (defsState.running) defsState = { ...defsState, running: false, phase: "idle", stopped: true, finishedAt: Math.floor(Date.now() / 1000) };
      return undefined as T;
    case "defs_query":
      if (!defsState.report) throw new Error("Nothing has been merged yet. Run it first, then ask.");
      if (!String(A.xpath ?? "").trim()) return { total: 0, matches: [], elapsedMs: 0 } as T;
      if (!String(A.xpath).startsWith("Defs")) throw new Error("the xpath does not parse: a query starts at Defs");
      return defsQuery(String(A.xpath), Number(A.limit ?? 50)) as T;
    case "defs_def":
      if (!defsState.report) throw new Error("Nothing has been merged yet. Run it first, then ask.");
      return defTree(String(A.defType), String(A.defName)) as T;
    case "patches_status":
      return structuredClone(patchJob) as T;
    case "patches_stop":
      patchJob = { ...patchJob, running: false, phase: "idle", cancelled: true, finishedAt: Math.floor(Date.now() / 1000) };
      return undefined as T;
    case "patches_start": {
      const r = patchReport();
      const total = r.perMod.reduce((n, m) => n + m.assemblies, 0);
      patchJob = { running: true, phase: "scanning", done: Math.floor(total / 3), total, current: "CombatExtended.dll", startedAt: Math.floor(Date.now() / 1000), finishedAt: 0, cancelled: false, error: null, summary: null };
      setTimeout(() => {
        patchDone = true;
        patchJob = { ...patchJob, running: false, phase: "idle", done: total, current: "", finishedAt: Math.floor(Date.now() / 1000), summary: patchSummary(r) };
      }, 1200);
      return undefined as T;
    }
    case "patches_report":
      // A finished run in the mock, so the view has something to show on the first look.
      return (patchDone || !patchJob.running ? patchReport() : null) as T;
    case "patches_for_mod":
      return patchesForMod(A.uid as string) as T;
    case "import_collection":
      return { ids: [2009463077, 818773962, 999], installed: [[2009463077, uidOf("brrainz.harmony")], [818773962, uidOf("unlimitedhugs.hugslib")]], missing: [999], names: { "2009463077": "Harmony", "818773962": "HugsLib", "999": "Some Missing Mod" } } as T;
    case "import_rentry":
      return { preview: { list: { packageIds: ["brrainz.harmony", "no.such"], format: "Rentry list" }, uids: [uidOf("brrainz.harmony")], missing: ["no.such"] }, missingWorkshopIds: [999] } as T;
    case "check_updates":
      return 1 as T;
    // These two fail the way Tauri commands do, with a plain string, so the UI shows the
    // words and not "Error:" in front of them.
    case "update_check":
      if (location.search.includes("offline")) return Promise.reject("Circinus could not reach circinus.sh. Check your internet connection and try again.");
      return (updateOffered && !updateInstalled ? MOCK_UPDATE : { available: false, current: MOCK_VERSION, version: null, notes: null, pubDate: null }) as T;
    case "update_install":
      if (!updateOffered) return Promise.reject(`Circinus ${MOCK_VERSION} is the newest version; there is nothing to install`);
      await installUpdate();
      return undefined as T;
    case "app_data_dir":
      return "C:\\Users\\Player\\AppData\\Local\\Circinus" as T;
    default:
      throw new Error(`mock: unknown command ${cmd}`);
  }
}

/** The shape of the log that crashed: frameworks above Core lost their parents, def generation threw, RimWorld reset, a quick-start crashed off the main thread. */
function mockLogAnalysis(path: string) {
  const dbh = uidOf("dubwise.dubsbadhygiene");
  const missing = ["MoteBase", "FleckBase_Thrown", "DiseaseBase", "InfectionBase", "ImplantHediffBase", "BodyPartBionicBase", "SurgeryInstallImplantBase", "FloorBase", "TileMetalBase", "BuildingBase"].map((p, i) => ({
    message: `XML error: Could not find parent node named "${p}" for node "ThingDef".`, sourceMod: "Dubs Bad Hygiene", file: `C:\\ws\\836308268\\1.6\\Defs\\x${i}.xml`, missingParent: p, defName: `DBH_Thing${i}`, line: 2340 + i
  }));
  const aboveCore = active.indexOf(dbh) >= 0 && active.indexOf(dbh) < active.indexOf(uidOf("ludeon.rimworld"));
  return {
    path, bytes: 3301258, modified: 1757016000,
    report: {
      lines: 30694, gameVersion: "1.6.4871 rev591", unityVersion: "2022.3.35f1", gpu: "NVIDIA GeForce RTX 4090", vramMb: 24138, commandLine: "-disable-compute-shaders",
      outcome: "crashed", reset: true, gaveUp: true,
      loadFailure: { message: "System.NullReferenceException: Object reference not set to an instance of an object", topFrame: "RimWorld.ThingDefGenerator_Buildings.NewFrameDef_Thing", modFrame: null, patchOwners: ["Uuugggg.rimworld.Replace_Stuff.main"], count: 1, line: 3100 },
      crash: { line: 30500, reason: "Graphics device is null.", frames: ["UnityEngine.Texture2D..ctor", "WorkRoles.UI.WorkRolesTex.MakeCircle"], culpritFrame: "WorkRoles.UI.WorkRolesTex.MakeCircle", offMainThread: true, quickstart: true },
      prepatcherVanillaLoadSecs: 463, prepatcherRestarted: true,
      timings: [{ label: "DefLoadCache pipeline", seconds: 463, line: 2340 }, { label: "Prepatcher vanilla load", seconds: 463, line: 200 }],
      duplicates: [{ packageId: "example.lootbeams", folders: ["Mods\\3f190c6b54b1", "Mods\\0438241173f4"] }],
      missingParents: missing, xmlErrors: [{ message: "Verse.PatchOperationReplace(xpath=\"Defs/ThingDef[defName=\"Mech_GloriaBO\"]/tools\"): Failed to find a node with the given xpath", sourceMod: "The Dead Man's Switch", file: null, missingParent: null, defName: null, line: 2280 }],
      exceptions: [{ message: "System.NullReferenceException: Object reference not set to an instance of an object", topFrame: "GravshipSize.GravshipSizeSettings.ApplySettingsNow", modFrame: "GravshipSize.GravshipSizeSettings.ApplySettingsNow", patchOwners: ["RedMattis.GravShipSize"], count: 1, line: 3130 }],
      ddsFailures: [{ path: "C:\\ws\\2842502659\\Textures\\UI\\Path_Old.dds", reason: "Compressed TextureFormat BC7 requires a texture size that is a multiple of 4", workshopId: 2842502659, modFolder: null, line: 5000 }],
      multipleOf4Warnings: { BC7: 9 }, threadTextureWarnings: 1, texturesNotFound: [["BMT_Caverns/UI/BG/BGCaves", 1], ["AM/UI/BG/Combined", 1]], texturesNotFoundTotal: 2, badTextureMaterials: 0, quickstart: true
    },
    mods: [
      { uid: dbh, name: "Dubs Bad Hygiene", active: active.includes(dbh), missingParents: missing.length, xmlErrors: 0, ddsFailures: 0, exceptions: 0, exceptionHits: 0, crashCulprit: false, loadFailurePatch: false, duplicateFolders: 0, aboveOfficial: aboveCore },
      { uid: null, name: "Work Roles", active: false, missingParents: 0, xmlErrors: 0, ddsFailures: 0, exceptions: 0, exceptionHits: 0, crashCulprit: true, loadFailurePatch: false, duplicateFolders: 0, aboveOfficial: false },
      { uid: null, name: "Gravship Size", active: false, missingParents: 0, xmlErrors: 0, ddsFailures: 0, exceptions: 1, exceptionHits: 1, crashCulprit: false, loadFailurePatch: false, duplicateFolders: 0, aboveOfficial: false },
      { uid: null, name: "The Dead Man's Switch", active: false, missingParents: 0, xmlErrors: 1, ddsFailures: 0, exceptions: 0, exceptionHits: 0, crashCulprit: false, loadFailurePatch: false, duplicateFolders: 0, aboveOfficial: false },
      { uid: null, name: "2842502659", active: false, missingParents: 0, xmlErrors: 0, ddsFailures: 1, exceptions: 0, exceptionHits: 0, crashCulprit: false, loadFailurePatch: false, duplicateFolders: 0, aboveOfficial: false }
    ],
    resolved: { WorkRoles: "Work Roles", GravshipSize: "Gravship Size", "RedMattis.GravShipSize": "Gravship Size" }
  };
}

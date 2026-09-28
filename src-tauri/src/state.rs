//! Application state: everything the UI sees, and the operations that change it.
//! No Tauri types here so it stays testable.

use crate::instances::{self, Instance};
use circinus_core::announce::Announcement;
use circinus_core::arrivals::Arrivals;
use circinus_core::cache::Cache;
use circinus_core::changes::{self, Baseline, ListChange, ModChange};
use circinus_core::dds;
use circinus_core::game::GameVersion;
use circinus_core::import::ImportedList;
use circinus_core::model::*;
use circinus_core::modsconfig::{self, ModsConfig, SavedList};
use circinus_core::loadcost;
use circinus_core::order::{self, Context, HaloRules, SectionDef, UserOverrides};
use circinus_core::paths::{app_data_dir, Locations};
use circinus_core::rules::{self, Databases, DbSource, RulesFile};
use circinus_core::scan::{self, Inspection, ModFiles, ScanOptions, Unreadable};
use circinus_core::steam::webapi::WorkshopItem;
use circinus_core::weight::{self, Weight};
use circinus_core::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// User overrides; None fields fall back to autodetection.
    pub locations: Locations,
    pub db_sources: Vec<DbSource>,
    pub show_weight: bool,
    pub include_local_runs: bool,
    pub alphabetical_within_phase: bool,
    pub update_databases_on_start: bool,
    /// Show the active list in HALO's phase sections rather than as the plain load order.
    pub list_by_phase: bool,
    /// Show the HALO page's advanced controls: making bands of your own in the load order, and
    /// what fills them. Off by default because the eight phases are the answer for most lists,
    /// and a page that opens with everything on it teaches nobody what the ordinary parts do.
    #[serde(default)]
    pub halo_advanced: bool,
    /// Column widths the user dragged in the list, in CSS pixels, by column key (`name`, `pkg`).
    pub columns: HashMap<String, u32>,
    /// The optional list columns that are shown: `load`, `versions`, `phase`, `group`.
    /// (The performance cost column follows `show_weight`.)
    pub list_columns: Vec<String>,
    /// Bumped when a default changes so that stored settings can be brought along.
    pub settings_version: u32,
    pub dds: DdsSettings,
    pub launch: LaunchSettings,
    /// Ask circinus.sh for a newer build a few seconds after launch. Nothing is installed
    /// without the user pressing the button.
    pub check_for_updates: bool,
}

/// The current `settings_version`: 2 made "by phase" the default view and hid the phase and
/// group columns; 3 added the update check on start; 4 added the Time column; 5 made the rule
/// databases ship switched off.
pub const SETTINGS_VERSION: u32 = 5;

pub fn default_list_columns() -> Vec<String> {
    vec!["time".into(), "load".into(), "versions".into()]
}

impl Default for Settings {
    fn default() -> Self {
        Settings { locations: Locations::default(), db_sources: rules::default_sources(), show_weight: false, include_local_runs: true, alphabetical_within_phase: false, update_databases_on_start: false, list_by_phase: true, halo_advanced: false, columns: HashMap::new(), list_columns: default_list_columns(), settings_version: SETTINGS_VERSION, dds: DdsSettings::default(), launch: LaunchSettings::default(), check_for_updates: true }
    }
}

impl Settings {
    /// Bring settings written by an older build up to the current defaults. Only the values a
    /// newer default changed are touched; everything the user set on purpose stays.
    pub fn migrate(&mut self) -> bool {
        if self.settings_version >= SETTINGS_VERSION {
            return false;
        }
        if self.settings_version < 2 {
            self.list_by_phase = true;
            self.list_columns = default_list_columns();
        }
        if self.settings_version < 3 {
            // A build from before auto-update existed had nothing to say about it; the new
            // default is on, and the toggle in Settings is one click for anyone who wants it off.
            self.check_for_updates = true;
        }
        if self.settings_version < 4 && !self.list_columns.iter().any(|c| c == "time") {
            // A new column is added to what is already shown rather than replacing it: someone
            // who turned Versions off meant that, and a new default is not a reason to undo it.
            // Show -> Columns turns this one off again in one click.
            self.list_columns.insert(0, "time".into());
        }
        // 5 made the rule databases ship switched off, and deliberately leaves an existing
        // install's switches alone. Anyone already running with the community rules has a load
        // order that was built with them; turning them all off on the strength of a new default
        // would rearrange that list overnight without asking. The new default is for a new
        // install. What this build changes for everyone is that the switch now does something:
        // whatever it says, on or off, is finally what happens.
        self.settings_version = SETTINGS_VERSION;
        true
    }
}

/// Where the window was when Circinus was last closed, in logical pixels.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

const WINDOW_KEY: &str = "window_state";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMethod {
    /// Steam when the game lives in a Steam library, the executable otherwise.
    #[default]
    Auto,
    /// `steam://rungameid/294100` — the overlay and Workshop sync behave as usual.
    Steam,
    /// Start the game's executable directly (GOG, DRM-free, a copy outside Steam).
    Executable,
}

/// How the Play button starts the game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchSettings {
    pub method: LaunchMethod,
    /// Explicit executable; None = detect from the game folder.
    pub executable: Option<PathBuf>,
    /// Extra command-line arguments, e.g. `-popupwindow`.
    pub args: String,
    /// Write ModsConfig.xml first when there are unsaved changes.
    pub save_first: bool,
}

impl Default for LaunchSettings {
    fn default() -> Self {
        LaunchSettings { method: LaunchMethod::Auto, executable: None, args: String::new(), save_first: true }
    }
}

/// Texture optimisation preferences.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DdsSettings {
    /// Format for textures with alpha; opaque ones are always BC1.
    pub alpha_format: dds::Format,
    pub quality: dds::Quality,
    pub mipmaps: bool,
    /// 0 = all cores but one.
    pub threads: usize,
    /// Convert new and updated mods on their own once anything has been converted.
    pub auto: bool,
}

impl Default for DdsSettings {
    fn default() -> Self {
        DdsSettings { alpha_format: dds::Format::Bc7, quality: dds::Quality::Balanced, mipmaps: true, threads: 0, auto: false }
    }
}

/// What the manifest says about one mod, kept in memory for the UI.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DdsSummary {
    pub count: usize,
    pub dds_bytes: u64,
    pub png_bytes: u64,
    /// Bytes the GPU would hold for these textures uncompressed (RGBA8 with mips).
    pub vram_before: u64,
    pub newest: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: String,
    /// Phase every member is placed in (unless the member has its own override). With
    /// `section` set, the phase the group's own section follows instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<Phase>,
    /// The group has its own place in the load order: its members sort together in a section
    /// of their own, right after the ordinary members of `phase`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub section: bool,
    /// Members the group picks up on its own, on top of the ones assigned by hand (a hand
    /// assignment to another group wins). Membership is worked out where the list is shown;
    /// it never feeds back into the order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<AutoRule>,
}

/// How a group finds its members by itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AutoRule {
    /// The game and its DLC.
    Official,
    /// Whatever HALO files under this phase: libraries, texture packs, performance mods…
    Phase { phase: Phase },
    /// Mods by an author (any listed author contains the text, case-insensitive).
    Author { name: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserData {
    pub groups: Vec<Group>,
    pub mod_groups: HashMap<String, String>,
    pub pinned: HashSet<String>,
    pub phase_overrides: HashMap<String, Phase>,
    pub notes: HashMap<String, String>,
    pub muted: HashSet<String>,
    /// Mods whose textures must not be converted.
    pub dds_excluded: HashSet<String>,
    /// Steam collections the user follows, with what they held when last looked at.
    pub collections: Vec<TrackedCollection>,
    /// The default groups have been given their automatic members once (an upgrade step; the
    /// user may switch them back to hand-picked afterwards and that sticks).
    pub auto_groups_adopted: bool,
    /// The starting groups have been offered once. Without this, "no groups" and "never had any"
    /// are the same state, and deleting every group brings them all back on the next launch --
    /// which is what happened. Set the first time the app opens, whether or not the groups were
    /// needed, so from then on an empty list means an empty list.
    pub groups_seeded: bool,
    /// The user's edits to HALO's classification, from the HALO page.
    pub halo: HaloRules,
    /// Collection id → the timestamp of the newest announcement the user has read.
    ///
    /// Read state and not the announcements themselves: the feed is the site's copy and is
    /// refetched, so the only thing worth keeping here is how far down it somebody got. Kept per
    /// pack rather than as one number, because catching up on one curator should not silence
    /// another.
    pub packs_read: HashMap<u64, i64>,
    /// Collections whose curator the user would rather not hear from. Following a pack to see
    /// what mods it holds and not wanting a running commentary is a reasonable position, and the
    /// alternative to allowing it is people unfollowing the pack.
    pub packs_muted: HashSet<u64>,
}

/// A Steam Workshop collection the user follows. `items` is what it holds now (last fetch);
/// `known` is what it held when the user last reviewed it, so additions and removals since
/// then can be shown until they are acknowledged.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrackedCollection {
    pub id: u64,
    pub name: String,
    pub creator: String,
    /// Workshop ids in the collection's order.
    pub items: Vec<u64>,
    pub known: Vec<u64>,
    /// Workshop id → title, for everything seen in it.
    pub names: HashMap<u64, String>,
    /// Unix seconds of the last fetch (0 = never), and of the last reviewed change.
    pub checked_at: i64,
    pub added_at: i64,
    /// Steam's own "last updated" time for the collection.
    pub time_updated: u64,
}

impl TrackedCollection {
    /// Items now in the collection that were not there when it was last reviewed.
    pub fn added(&self) -> Vec<u64> {
        self.items.iter().filter(|i| !self.known.contains(i)).copied().collect()
    }
    /// Items that were there when last reviewed and are gone now.
    pub fn removed(&self) -> Vec<u64> {
        self.known.iter().filter(|i| !self.items.contains(i)).copied().collect()
    }
}

/// A list the user keeps by name, in ModsConfig.xml form, under `<data>/lists/named/`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedList {
    pub name: String,
    pub path: PathBuf,
    pub count: usize,
    /// Unix seconds of the last write.
    pub updated_at: i64,
    pub game_version: String,
}

/// The groups everyone starts with. Three fill themselves: the game and its DLC, the libraries,
/// and the performance mods, as HALO files them.
/// One key for a pair of mods, whichever way round they are named. The databases record the
/// incompatibility on one of the two and the UI shows it on both, so a key that depended on the
/// order would hide the warning in one place and leave it in the other.
pub fn incompatible_key(a: &str, b: &str) -> String {
    let (x, y) = if a <= b { (a, b) } else { (b, a) };
    format!("incompatible:{x}|{y}")
}

fn default_groups() -> Vec<Group> {
    vec![
        Group { id: "core".into(), name: "Core".into(), color: "blue".into(), phase: None, section: false, auto: Some(AutoRule::Official) },
        Group { id: "frameworks".into(), name: "Frameworks".into(), color: "teal".into(), phase: None, section: false, auto: Some(AutoRule::Phase { phase: Phase::Framework }) },
        Group { id: "qol".into(), name: "Quality of life".into(), color: "green".into(), phase: None, section: false, auto: None },
        Group { id: "visual".into(), name: "Visual".into(), color: "amber".into(), phase: None, section: false, auto: None },
        Group { id: "performance".into(), name: "Performance".into(), color: "coral".into(), phase: Some(Phase::Optimization), section: false, auto: Some(AutoRule::Phase { phase: Phase::Optimization }) },
    ]
}

/// Give the default groups of an existing install their automatic members, as long as the
/// user has not put anything in them by hand (then they are theirs to run).
fn adopt_auto_groups(user: &mut UserData) {
    let used: HashSet<&String> = user.mod_groups.values().collect();
    for def in default_groups() {
        let Some(rule) = def.auto else { continue };
        if let Some(g) = user.groups.iter_mut().find(|g| g.id == def.id) {
            if g.auto.is_none() && !used.contains(&g.id) {
                g.auto = Some(rule);
            }
        }
    }
}

/// Everything the UI needs to render, in one message.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub locations: Locations,
    pub game_version: GameVersion,
    pub mods: Vec<ModInfo>,
    pub active: Vec<String>,
    pub missing: Vec<String>,
    pub issues: Vec<Issue>,
    pub placements: Vec<Placement>,
    pub rules: Vec<Rule>,
    pub user: UserData,
    pub settings: Settings,
    pub weights: HashMap<String, Weight>,
    pub weights_fetched_at: i64,
    /// One raw record as circinus.sh sent it, for checking the field names when figures look off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights_sample: Option<String>,
    pub dirty: bool,
    pub db_loaded: Vec<String>,
    pub scanned_at: i64,
    /// Mods whose folders are still being inspected in the background.
    pub inspecting: usize,
    /// Entries in a mod folder the scan had to leave out, with the reason.
    #[serde(default)]
    pub unreadable: Vec<Unreadable>,
    /// Texture-collision issues left out of `issues` to keep the payload small (0 = none).
    pub issues_truncated: usize,
    /// Installed workshop mods with a newer version on the Workshop (from the last check).
    pub updates: Vec<UpdateInfo>,
    pub updates_checked_at: i64,
    /// Mods that appeared, disappeared or changed since the previous session (or since the
    /// user last acknowledged the list).
    pub changes: Vec<ModChange>,
    /// Edits to ModsConfig.xml made outside Circinus since then.
    pub list_change: Option<ListChange>,
    /// Unix seconds of the baseline the changes are measured from (0 = first run).
    pub changes_since: i64,
    /// uid → unix seconds Circinus first saw that folder. Only mods that arrived after the
    /// record was started are in here; the ones that were already installed the first time we
    /// looked have no arrival date to show, which is different from having arrived long ago.
    pub first_seen: HashMap<String, i64>,
    /// The mods still worth marking new, most recent first. Worked out here rather than in the
    /// UI so the list, the tab and the count cannot disagree about what new means.
    pub new_uids: Vec<String>,
    /// uid → what Circinus has converted for it.
    pub dds: HashMap<String, DdsSummary>,
    /// Set when ModsConfig.xml holds only official content although a real list was there
    /// before: RimWorld failed to load and reset it.
    pub list_reset: Option<ListReset>,
    /// The named list being worked on, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_list: Option<String>,
    /// The user's named lists, newest first.
    #[serde(default)]
    pub named_lists: Vec<NamedList>,
    /// The instance these folders and lists belong to.
    pub instance: Instance,
    /// What the curators of the followed packs have said, newest first, muted packs left out.
    #[serde(default)]
    pub announcements: Vec<Announcement>,
    /// Unix seconds of the last successful announcement fetch (0 = never asked).
    pub announcements_checked_at: i64,
}

/// RimWorld gave up loading and wrote a Core-only list; here is what to put back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListReset {
    /// Mods in the list before the reset.
    pub previous_count: usize,
    /// The newest archived copy of a real list, if any.
    pub restore_from: Option<SavedList>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub uid: String,
    pub published_file_id: u64,
    pub name: String,
    pub local_modified: u64,
    pub remote_updated: u64,
    pub source: Source,
}

/// What Circinus offers updates for: a Steam mod, which a Force update replaces in Steam's own
/// folder, and a copy Circinus downloaded or kept, which it replaces in Mods. Other local folders
/// with a Workshop id, such as dev builds, never go on the list.
pub fn updatable(m: &ModInfo) -> bool {
    m.invalid.is_none() && m.published_file_id.is_some() && matches!(m.source, Source::Workshop | Source::SteamCmd)
}

/// The Workshop has something newer than what is on disk, allowing a minute for clocks.
fn behind(remote_updated: u64, m: &ModInfo) -> bool {
    remote_updated > m.modified + 60
}

/// Keep only the updates that still apply: the mod is still installed, can still be updated, and
/// is still older than what the Workshop had at the check. The check only runs when asked, so
/// without this a mod Steam updated after the check stayed listed until the next check, and
/// "Update all" downloaded it again.
fn still_behind(updates: &mut Vec<UpdateInfo>, mods: &[ModInfo]) {
    let by_uid: HashMap<&str, &ModInfo> = mods.iter().map(|m| (m.uid.as_str(), m)).collect();
    updates.retain_mut(|u| match by_uid.get(u.uid.as_str()) {
        Some(m) if updatable(m) && m.published_file_id == Some(u.published_file_id) && behind(u.remote_updated, m) => {
            u.local_modified = m.modified;
            u.source = m.source;
            true
        }
        _ => false,
    });
}

/// A Force update's Workshop id, with Steam's folder when the download replaces Steam's copy
/// (none means `Mods/<id>`).
pub type UpdateTarget = (u64, Option<String>);

/// Where a Force update of `m` goes, or why it has none. A Steam mod is replaced in Steam's own
/// folder, which has to be in the Workshop folder Circinus reads, since that path is handed to
/// code that deletes and rewrites it. A copy Circinus made is replaced in Mods, where it already
/// is. A broken download can be updated, since that is how it gets fixed; other local folders
/// cannot.
fn update_target(m: &ModInfo, workshop_dir: Option<&Path>) -> std::result::Result<UpdateTarget, String> {
    let Some(id) = m.published_file_id else {
        return Err(format!("{} has no Workshop id, so there is nothing to update it from", m.name));
    };
    match m.source {
        Source::Workshop => match workshop_dir {
            Some(ws) if m.path == ws.join(id.to_string()) => Ok((id, Some(m.path.display().to_string()))),
            _ => Err(format!("Circinus could not tell where Steam keeps {}, so it was left alone", m.name)),
        },
        Source::SteamCmd => Ok((id, None)),
        _ => Err(format!("{} is a local folder, not one Steam or Circinus downloaded, so it was left alone", m.name)),
    }
}

/// Texture collisions kept in a snapshot; the rest are available through the analyzer commands.
const MAX_COLLISIONS: usize = 3000;

pub struct App {
    pub data_dir: PathBuf,
    pub cache: Cache,
    pub settings: Settings,
    pub user: UserData,
    pub locations: Locations,
    pub game_version: GameVersion,
    pub mods: Vec<ModInfo>,
    pub files: HashMap<String, ModFiles>,
    pub active: Vec<String>,
    pub missing: Vec<String>,
    pub previous_known: Vec<String>,
    pub db: Databases,
    pub rules: Vec<Rule>,
    pub weights: HashMap<String, Weight>,
    pub weights_fetched_at: i64,
    pub weights_sample: Option<String>,
    pub dirty: bool,
    pub scanned_at: i64,
    /// uids not yet inspected, and the cache stamps to write once they are.
    pub shallow: Vec<String>,
    pub pending_stamps: HashMap<String, String>,
    /// Mod folder entries the last scan could not read (links to nowhere, mostly).
    pub unreadable: Vec<Unreadable>,
    pub updates: Vec<UpdateInfo>,
    pub updates_checked_at: i64,
    /// The curator feed as last fetched. Not persisted: it is the site's copy, and a stale one
    /// shown at launch before the refresh lands would be worse than an empty panel for a moment.
    pub announcements: Vec<Announcement>,
    pub announcements_checked_at: i64,
    /// What the previous session last saw; `changes` is the diff against it.
    pub baseline: Option<Baseline>,
    /// When each mod folder was first seen, and which of those are still marked new. Unlike the
    /// baseline this is not retaken every scan, which is the whole point: a mark on a row has to
    /// outlive the rescan that the eight second folder poll runs a moment later.
    pub arrivals: Arrivals,
    pub changes: Vec<ModChange>,
    pub list_change: Option<ListChange>,
    /// Steam's `timeupdated` per installed Workshop item, read with every scan.
    pub workshop_updated: HashMap<u64, u64>,
    /// The active list exactly as ModsConfig.xml has it (package ids, lowercase).
    pub file_active: Vec<String>,
    /// uid → converted-texture summary, from the manifest.
    pub dds_index: HashMap<String, DdsSummary>,
    pub list_reset: Option<ListReset>,
    /// The named list the active list came from, or was last saved to. Save writes it too.
    pub current_list: Option<String>,
    /// The instance that is open: which folders these mods came from. Its `locations` and
    /// `launch` are the same values as `settings.locations` and `settings.launch` — Settings
    /// edits the instance that is open.
    pub instance: Instance,
}

/// How many archived lists to keep.
const LIST_HISTORY: usize = 40;

/// Unix seconds.
pub fn now_secs() -> i64 {
    now()
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

impl App {
    pub fn open() -> Result<App> {
        App::open_at(app_data_dir(), None)
    }

    /// Open with an explicit data folder and (for tests and tools) explicit settings.
    pub fn open_at(data_dir: PathBuf, settings_override: Option<Settings>) -> Result<App> {
        std::fs::create_dir_all(data_dir.join("dbs"))?;
        let cache = Cache::open(&data_dir.join("cache.sqlite"))?;
        let explicit = settings_override.is_some();
        let mut settings: Settings = match settings_override {
            Some(s) => s,
            None => {
                let mut s: Settings = cache.get("settings")?.unwrap_or_default();
                if s.migrate() {
                    if let Err(e) = cache.set("settings", &s) {
                        tracing::warn!("could not store the migrated settings: {e}");
                    }
                }
                s
            }
        };
        let mut user: UserData = cache.get("user")?.unwrap_or_default();
        // Groups to start from, once. An install that already has some has clearly been opened
        // before, so it is marked as seeded without being given anything: only a genuinely fresh
        // one gets the defaults, and deleting them afterwards is a decision that sticks.
        if !user.groups_seeded {
            if user.groups.is_empty() {
                user.groups = default_groups();
            }
            user.groups_seeded = true;
            if let Err(e) = cache.set("user", &user) {
                tracing::warn!("could not store the user data: {e}");
            }
        }
        if !user.auto_groups_adopted {
            adopt_auto_groups(&mut user);
            user.auto_groups_adopted = true;
            if let Err(e) = cache.set("user", &user) {
                tracing::warn!("could not store the user data: {e}");
            }
        }
        // Instances first: which one is open decides where the named lists, the current list and
        // the change baseline are read from. An install made before instances existed becomes the
        // Default instance here, with its settings and lists intact.
        let store = instances::load(&cache, &data_dir, &settings)?;
        let mut instance = store.current().cloned().unwrap_or_else(|| store.instances[0].clone());
        if explicit {
            // Settings handed in by a test or a tool are the folders to use; the instance follows.
            instance.locations = settings.locations.clone();
            instance.launch = settings.launch.clone();
        } else {
            settings.locations = instance.locations.clone();
            settings.launch = instance.launch.clone();
        }
        let baseline: Option<Baseline> = cache.get(&instances::baseline_key(&instance.id)).unwrap_or(None);
        let arrivals: Arrivals = cache.get(&instances::arrivals_key(&instance.id)).unwrap_or(None).unwrap_or_default();
        let current_list: Option<String> = cache.get(&instances::current_list_key(&instance.id)).unwrap_or(None).flatten();
        let mut app = App {
            data_dir,
            cache,
            settings,
            user,
            locations: Locations::default(),
            game_version: GameVersion::fallback("1.6"),
            mods: Vec::new(),
            files: HashMap::new(),
            active: Vec::new(),
            missing: Vec::new(),
            previous_known: Vec::new(),
            db: Databases::default(),
            rules: Vec::new(),
            weights: HashMap::new(),
            weights_fetched_at: 0,
            weights_sample: None,
            dirty: false,
            scanned_at: 0,
            shallow: Vec::new(),
            pending_stamps: HashMap::new(),
            unreadable: Vec::new(),
            updates: Vec::new(),
            updates_checked_at: 0,
            announcements: Vec::new(),
            announcements_checked_at: 0,
            baseline,
            arrivals,
            changes: Vec::new(),
            list_change: None,
            workshop_updated: HashMap::new(),
            file_active: Vec::new(),
            dds_index: HashMap::new(),
            list_reset: None,
            current_list,
            instance,
        };
        app.resolve_locations();
        // Before loading, not after: a build before this one ignored the switch entirely, so a
        // user who turned a database off months ago still has its file sitting there.
        app.forget_disabled_databases();
        app.load_databases();
        app.load_cached_weights()?;
        app.reload_dds_index();
        Ok(app)
    }

    /// Read the state that belongs to the instance now open: which named list is being worked
    /// on, and what its changes are measured from. Called after switching instance.
    pub fn adopt_instance_state(&mut self) {
        self.current_list = self.cache.get::<Option<String>>(&instances::current_list_key(&self.instance.id)).unwrap_or(None).flatten();
        self.baseline = self.cache.get(&instances::baseline_key(&self.instance.id)).unwrap_or(None);
        self.arrivals = self.cache.get(&instances::arrivals_key(&self.instance.id)).unwrap_or(None).unwrap_or_default();
    }

    /// Rebuild the per-mod summary from the manifest table.
    pub fn reload_dds_index(&mut self) {
        let all: HashMap<String, Vec<dds::Entry>> = self.cache.dds_all().unwrap_or_default();
        self.dds_index = all
            .into_iter()
            .map(|(uid, entries)| {
                let s = DdsSummary {
                    count: entries.len(),
                    dds_bytes: entries.iter().map(|e| e.dds_len).sum(),
                    png_bytes: entries.iter().map(|e| e.src_len).sum(),
                    vram_before: entries.iter().map(|e| (e.width as u64 * e.height as u64 * 4) * 4 / 3).sum(),
                    newest: entries.iter().map(|e| e.created_at).max().unwrap_or(0),
                };
                (uid, s)
            })
            .collect();
    }

    /// Autodetect, then apply user overrides on top.
    pub fn resolve_locations(&mut self) {
        let mut loc = Locations::detect();
        let o = &self.settings.locations;
        if o.game_dir.is_some() {
            loc.game_dir = o.game_dir.clone();
            loc.local_mods_dir = None;
        }
        if o.config_dir.is_some() {
            loc.config_dir = o.config_dir.clone();
        }
        if o.local_mods_dir.is_some() {
            loc.local_mods_dir = o.local_mods_dir.clone();
        }
        if o.workshop_dir.is_some() {
            loc.workshop_dir = o.workshop_dir.clone();
        }
        loc.fill_derived();
        self.game_version = loc.game_dir.as_ref().and_then(|g| GameVersion::read(g)).unwrap_or_else(|| GameVersion::fallback("1.6"));
        self.locations = loc;
    }

    pub fn load_databases(&mut self) {
        let user_rules = rules::user_rules_path(&self.data_dir);
        self.db = Databases::load(&self.data_dir.join("dbs"), &user_rules, &self.game_version.major_minor, &self.settings.db_sources);
        self.recompile();
    }

    /// Remove the files of every source that is switched off.
    ///
    /// Run whenever the sources change and once on startup, rather than only on the click that
    /// turned one off: a copy that was left behind by an older build, or by a delete Windows
    /// refused while the file was open, is still a database the user said they did not want.
    pub fn forget_disabled_databases(&mut self) -> Vec<PathBuf> {
        let dir = self.data_dir.join("dbs");
        let version = self.game_version.major_minor.clone();
        let mut gone = Vec::new();
        for src in self.settings.db_sources.iter().filter(|s| !s.enabled) {
            gone.extend(rules::forget_source(&dir, src, &version));
        }
        if !gone.is_empty() {
            tracing::info!("removed {} file(s) for switched-off databases", gone.len());
        }
        gone
    }

    fn recompile(&mut self) {
        self.rules = rules::compile_rules(&self.mods, &self.db);
    }

    fn overrides(&self) -> UserOverrides {
        let mut phases: HashMap<String, Phase> = HashMap::new();
        let mut sections: HashMap<String, String> = HashMap::new();
        for (uid, gid) in &self.user.mod_groups {
            let Some(g) = self.user.groups.iter().find(|g| &g.id == gid) else { continue };
            match (g.section, g.phase) {
                (true, Some(_)) => {
                    sections.insert(uid.clone(), gid.clone());
                }
                (false, Some(p)) => {
                    phases.insert(uid.clone(), p);
                }
                _ => {}
            }
        }
        // An explicit per-mod choice beats the group.
        for (uid, p) in &self.user.phase_overrides {
            phases.insert(uid.clone(), *p);
            sections.remove(uid);
        }
        let section_defs = self.user.groups.iter().filter(|g| g.section).filter_map(|g| g.phase.map(|after| SectionDef { id: g.id.clone(), name: g.name.clone(), after })).collect();
        UserOverrides { phases, sections, section_defs, pinned: self.user.pinned.clone(), alphabetical: self.settings.alphabetical_within_phase, halo: self.user.halo.clone() }
    }

    fn with_context<T>(&self, f: impl FnOnce(&Context) -> T) -> T {
        let ov = self.overrides();
        let ctx = Context { mods: &self.mods, files: &self.files, rules: &self.rules, db: &self.db, major_minor: &self.game_version.major_minor, overrides: &ov };
        f(&ctx)
    }

    /// Phase 1: read every mod's About/ folder (fast) and resolve ModsConfig.xml. Returns the
    /// mods whose folders still need walking; hand them to `scan::inspect_mods` outside the lock,
    /// then call `apply_inspections`.
    pub fn scan_quick(&mut self, full: bool, progress: &(dyn Fn(usize, usize) + Sync)) -> Result<Vec<ModInfo>> {
        if full {
            self.cache.clear_mod_cache()?;
        }
        self.workshop_updated = self.locations.workshop_updated();
        let opts = ScanOptions { locations: self.locations.clone(), game_version: self.game_version.clone(), use_cache: !full, workshop_updated: self.workshop_updated.clone() };
        let out = scan::scan(&opts, Some(&self.cache), false, progress)?;
        self.mods = out.mods;
        self.files = out.files;
        self.shallow = out.shallow;
        self.pending_stamps = out.stamps;
        self.unreadable = out.unreadable;
        self.scanned_at = now();
        self.recompile();
        self.read_mods_config();
        self.refresh_changes();
        self.refresh_updates();
        self.note_arrivals();
        self.store_baseline();
        let shallow: Vec<ModInfo> = self.mods.iter().filter(|m| self.shallow.contains(&m.uid)).cloned().collect();
        Ok(shallow)
    }

    /// Phase 2: merge folder inspections and write them to the cache.
    pub fn apply_inspections(&mut self, inspections: Vec<Inspection>) -> Result<usize> {
        let done: HashSet<String> = inspections.iter().map(|i| i.uid.clone()).collect();
        let n = scan::apply_inspections(&mut self.mods, &mut self.files, &self.pending_stamps, inspections, Some(&self.cache))?;
        self.shallow.retain(|u| !done.contains(u));
        for u in &done {
            self.pending_stamps.remove(u);
        }
        self.refresh_changes();
        self.refresh_updates();
        self.store_baseline();
        Ok(n)
    }

    /// Diff the install against the baseline the session started with.
    fn refresh_changes(&mut self) {
        match &self.baseline {
            Some(b) => {
                let active: HashSet<String> = self.active.iter().cloned().collect();
                let (c, l) = changes::diff(b, &self.mods, &self.workshop_updated, &active, Some(&self.file_active));
                self.changes = c;
                self.list_change = l;
            }
            None => {
                self.changes.clear();
                self.list_change = None;
            }
        }
    }

    /// Remember the current install for the next launch. Becomes the session baseline too on
    /// the very first run, once the folders have been fully inspected (quick-phase mtimes
    /// would otherwise read as changes a moment later).
    fn store_baseline(&mut self) {
        let b = Baseline::take(&self.mods, &self.workshop_updated, &self.file_active, now());
        if let Err(e) = self.cache.set(&instances::baseline_key(&self.instance.id), &b) {
            tracing::warn!("could not store the mod baseline: {e}");
        }
        if self.baseline.is_none() && self.shallow.is_empty() {
            self.baseline = Some(b);
        }
    }

    /// Note which folders are here, so an arrival is remembered rather than inferred.
    ///
    /// Only written when something actually changed. The folder poll rescans every eight seconds
    /// whenever Steam touches a directory, and a record rewritten that often for no reason is a
    /// write amplifier on an sqlite file the user did not ask us to churn.
    fn note_arrivals(&mut self) {
        if !self.arrivals.observe(self.mods.iter().map(|m| m.uid.clone()), now()) {
            return;
        }
        if let Err(e) = self.cache.set(&instances::arrivals_key(&self.instance.id), &self.arrivals) {
            tracing::warn!("could not store when the mods arrived: {e}");
        }
    }

    /// How many instances there are, for the report: "instance 1 of 1" and "instance 1 of 4" are
    /// different situations and the second is where instance bugs live.
    pub fn instance_count(&self) -> usize {
        instances::load(&self.cache, &self.data_dir, &self.settings).map(|s| s.instances.len()).unwrap_or(1)
    }

    /// The user has seen what is new: stop marking it.
    pub fn mark_new_seen(&mut self) {
        self.arrivals.clear(now());
        if let Err(e) = self.cache.set(&instances::arrivals_key(&self.instance.id), &self.arrivals) {
            tracing::warn!("could not store when the mods arrived: {e}");
        }
    }

    /// The user has seen the changes: measure from now on.
    pub fn acknowledge_changes(&mut self) {
        let b = Baseline::take(&self.mods, &self.workshop_updated, &self.file_active, now());
        if let Err(e) = self.cache.set(&instances::baseline_key(&self.instance.id), &b) {
            tracing::warn!("could not store the mod baseline: {e}");
        }
        self.baseline = Some(b);
        self.changes.clear();
        self.list_change = None;
    }

    /// Read ModsConfig.xml and resolve it against installed mods (keeps unsaved edits if dirty).
    pub fn read_mods_config(&mut self) {
        if self.dirty {
            let existing = self.active.clone();
            let live: HashSet<&str> = self.mods.iter().map(|m| m.uid.as_str()).collect();
            self.active = existing.into_iter().filter(|u| live.contains(u.as_str())).collect();
            return;
        }
        // Whether there is a list at all, kept apart from what it says. A synthesised one is
        // Core and nothing else, which is exactly the shape of RimWorld's own reset -- so an
        // instance whose config folder is still empty was being announced as a list the game had
        // just wiped, with a button offering to restore something over it.
        let read = self.locations.mods_config_path().and_then(|p| modsconfig::read(&p).ok());
        let had_a_list = read.is_some();
        let cfg = read.unwrap_or_else(|| ModsConfig { version: self.game_version.full.clone(), active_mods: vec![CORE_PACKAGE_ID.into()], known_expansions: vec![] });
        let (uids, missing) = modsconfig::resolve_active(&cfg.active_mods, &self.mods);
        self.active = uids;
        self.missing = missing;
        self.file_active = cfg.active_mods.iter().map(|p| p.to_lowercase()).collect();
        self.previous_known = cfg.known_expansions.clone();
        self.dirty = false;
        // Keep every real list we come across, whoever wrote it — and notice RimWorld's
        // "resetting mods config" recovery, which leaves only official content behind.
        if had_a_list && modsconfig::looks_reset(&cfg.active_mods) {
            // The list this session started with is a copy too: archive it before it is lost.
            if let Some(b) = &self.baseline {
                if b.active.len() > cfg.active_mods.len() && !modsconfig::looks_reset(&b.active) {
                    let prev = ModsConfig { version: self.game_version.full.clone(), active_mods: b.active.clone(), known_expansions: cfg.known_expansions.clone() };
                    let _ = modsconfig::archive(&self.lists_dir(), &prev, "before-reset", LIST_HISTORY);
                }
            }
            let history: Vec<SavedList> = modsconfig::list_archive(&self.lists_dir()).into_iter().filter(|l| l.count > cfg.active_mods.len()).collect();
            let previous_count = self.baseline.as_ref().map(|b| b.active.len()).filter(|n| *n > cfg.active_mods.len()).or_else(|| history.first().map(|l| l.count)).unwrap_or(0);
            if previous_count > cfg.active_mods.len() {
                self.list_reset = Some(ListReset { previous_count, restore_from: history.into_iter().next() });
            }
        } else {
            self.list_reset = None;
            if let Err(e) = modsconfig::archive(&self.lists_dir(), &cfg, "seen", LIST_HISTORY) {
                tracing::warn!("could not archive the list: {e}");
            }
        }
    }

    /// Where this instance's archived copies of ModsConfig.xml live.
    ///
    /// Per instance, for the reason the named lists are: an archive shared between instances is
    /// one instance's mod list offered to another as its own history, and the offer comes with a
    /// button that writes it. Copies made before instances existed are moved into the default
    /// instance's folder the first time this is asked for, so nobody's history disappears.
    pub fn lists_dir(&self) -> PathBuf {
        let root = self.data_dir.join("lists");
        let mine = root.join("archive").join(&self.instance.id);
        if self.instance.id == instances::DEFAULT_ID && !mine.exists() {
            if let Ok(entries) = std::fs::read_dir(&root) {
                let loose: Vec<PathBuf> = entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file() && p.extension().map(|x| x == "xml").unwrap_or(false)).collect();
                if !loose.is_empty() && std::fs::create_dir_all(&mine).is_ok() {
                    for p in loose {
                        if let Some(name) = p.file_name() {
                            if let Err(e) = std::fs::rename(&p, mine.join(name)) {
                                tracing::warn!("could not move an archived list into the default instance: {e}");
                            }
                        }
                    }
                }
            }
        }
        mine
    }

    /// Archived lists, newest first.
    pub fn saved_lists(&self) -> Vec<SavedList> {
        modsconfig::list_archive(&self.lists_dir())
    }

    /// Make an archived list the active list (unsaved until `save`).
    pub fn restore_list(&mut self, path: &std::path::Path) -> Result<(usize, Vec<String>)> {
        let cfg = modsconfig::read(path)?;
        let (uids, missing) = modsconfig::resolve_active(&cfg.active_mods, &self.mods);
        let n = uids.len();
        self.set_active(uids);
        self.list_reset = None;
        Ok((n, missing))
    }

    /// Have we read enough of the install to say what is and is not there? Every mod folder the
    /// locations point at has been through About.xml at least once. Before that, saying a
    /// dependency is "not installed" is a guess, and a wrong one for anybody whose Workshop
    /// folder had not been found yet.
    pub fn install_known(&self) -> bool {
        if self.scanned_at == 0 || self.mods.is_empty() {
            return false;
        }
        // A Workshop folder that produced nothing means the scan did not reach it (Steam moving
        // files, a library on a drive that was not mounted yet): everything subscribed would
        // look uninstalled, and it is not.
        if self.locations.workshop_dir.is_some() && !self.mods.iter().any(|m| m.source == Source::Workshop) {
            return false;
        }
        self.locations.workshop_dir.is_some() || self.locations.local_mods_dir.is_some()
    }

    pub fn issues(&self) -> Vec<Issue> {
        let mut issues = self.with_context(|ctx| order::validate(&self.active, ctx));
        if !self.install_known() {
            issues.retain(|i| !matches!(i, Issue::MissingDependency { .. }));
        }
        // Warnings the user has said are wrong about their install. The databases say two mods do
        // not work together; sometimes they did once and a patch fixed it, and a warning that
        // cannot be dismissed is one a player learns to ignore -- along with the true ones beside
        // it, which is the actual cost.
        if !self.user.muted.is_empty() {
            issues.retain(|i| match i {
                Issue::Incompatible { uid, other_uid, .. } => !self.user.muted.contains(&incompatible_key(self.package_of(uid), self.package_of(other_uid))),
                _ => true,
            });
        }
        issues
    }

    /// The package id of a mod, or its uid when it has none, so a hidden warning survives the mod
    /// being uninstalled and put back: the folder changes, the package id does not.
    fn package_of<'a>(&'a self, uid: &'a str) -> &'a str {
        self.mods.iter().find(|m| m.uid == uid).map(|m| m.package_id.as_str()).filter(|p| !p.is_empty()).unwrap_or(uid)
    }

    /// Hide, or stop hiding, the "these two do not work together" warning for a pair.
    pub fn set_incompatibility_hidden(&mut self, uid: &str, other_uid: &str, hidden: bool) -> Result<()> {
        let key = incompatible_key(self.package_of(uid), self.package_of(other_uid));
        if hidden {
            self.user.muted.insert(key);
        } else {
            self.user.muted.remove(&key);
        }
        self.persist()
    }

    /// Show every warning again.
    pub fn clear_hidden_warnings(&mut self) -> Result<usize> {
        let n = self.user.muted.len();
        self.user.muted.clear();
        self.persist()?;
        Ok(n)
    }

    pub fn placements(&self) -> Vec<Placement> {
        let by_uid: HashMap<&str, &ModInfo> = self.mods.iter().map(|m| (m.uid.as_str(), m)).collect();
        let order: Vec<&ModInfo> = self.active.iter().filter_map(|u| by_uid.get(u.as_str()).copied()).collect();
        self.with_context(|ctx| order::placements(&order, ctx))
    }

    pub fn snapshot(&self) -> Snapshot {
        let started = std::time::Instant::now();
        // Descriptions are the bulk of the payload and only one is ever shown at a time:
        // the UI fetches them with `get_description`.
        let mods: Vec<ModInfo> = self
            .mods
            .iter()
            .map(|m| {
                let mut m = ModInfo { description: String::new(), ..m.clone() };
                // The estimate is a model over cached facts: computed here so a better model
                // applies without a re-scan.
                m.contents.load.score_ms = loadcost::score(&m.contents);
                m
            })
            .collect();
        let mut issues = self.issues();
        let collisions = issues.iter().filter(|i| matches!(i, Issue::TextureCollision { .. })).count();
        let mut issues_truncated = 0;
        if collisions > MAX_COLLISIONS {
            let mut kept = 0;
            issues.retain(|i| {
                if matches!(i, Issue::TextureCollision { .. }) {
                    kept += 1;
                    kept <= MAX_COLLISIONS
                } else {
                    true
                }
            });
            issues_truncated = collisions - MAX_COLLISIONS;
        }
        let placements = self.placements();
        tracing::info!(mods = mods.len(), active = self.active.len(), issues = issues.len(), rules = self.rules.len(), ms = started.elapsed().as_millis() as u64, "snapshot");
        Snapshot {
            locations: self.locations.clone(),
            game_version: self.game_version.clone(),
            mods,
            active: self.active.clone(),
            missing: self.missing.clone(),
            issues,
            placements,
            rules: self.rules.clone(),
            user: self.user.clone(),
            settings: self.settings.clone(),
            weights: self.weights.clone(),
            weights_fetched_at: self.weights_fetched_at,
            weights_sample: self.weights_sample.clone(),
            dirty: self.dirty,
            db_loaded: self.db.loaded.clone(),
            scanned_at: self.scanned_at,
            inspecting: self.shallow.len(),
            unreadable: self.unreadable.clone(),
            issues_truncated,
            updates: self.updates.clone(),
            updates_checked_at: self.updates_checked_at,
            changes: self.changes.clone(),
            first_seen: self.arrivals.seen.iter().filter(|(_, &t)| t > 0).map(|(u, &t)| (u.clone(), t)).collect(),
            new_uids: self.arrivals.new_uids(now()),
            list_change: self.list_change.clone(),
            changes_since: self.baseline.as_ref().map(|b| b.taken_at).unwrap_or(0),
            dds: self.dds_index.clone(),
            list_reset: self.list_reset.clone(),
            current_list: self.current_list.clone(),
            named_lists: self.named_lists(),
            instance: self.instance.clone(),
            announcements: self.announcements.iter().filter(|a| !self.user.packs_muted.contains(&a.pack)).cloned().collect(),
            announcements_checked_at: self.announcements_checked_at,
        }
    }

    // ---- named lists ----

    /// Each instance keeps its named lists in a folder of its own.
    pub fn named_dir(&self) -> PathBuf {
        instances::named_dir_for(&self.data_dir, &self.instance.id)
    }

    /// A file name for a list name: the characters no file system takes are replaced.
    fn list_file_name(name: &str) -> Option<String> {
        let clean: String = name.trim().chars().map(|c| if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '-' } else { c }).collect();
        let clean = clean.trim().trim_matches('.').to_string();
        if clean.is_empty() || clean.len() > 120 {
            return None;
        }
        Some(format!("{clean}.xml"))
    }

    /// The user's named lists, newest first.
    pub fn named_lists(&self) -> Vec<NamedList> {
        let Ok(rd) = std::fs::read_dir(self.named_dir()) else { return Vec::new() };
        let mut out: Vec<NamedList> = rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "xml").unwrap_or(false))
            .filter_map(|p| {
                let cfg = modsconfig::read(&p).ok()?;
                let name = p.file_stem()?.to_string_lossy().to_string();
                let updated_at = std::fs::metadata(&p).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
                Some(NamedList { name, path: p, count: cfg.active_mods.len(), updated_at, game_version: cfg.version })
            })
            .collect();
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.name.cmp(&b.name)));
        out
    }

    fn set_current_list(&mut self, name: Option<String>) {
        self.current_list = name;
        if let Err(e) = self.cache.set(&instances::current_list_key(&self.instance.id), &self.current_list) {
            tracing::warn!("could not remember the current list: {e}");
        }
    }

    /// Write the active list under a name (new or existing) and make it the current list.
    pub fn save_named_list(&mut self, name: &str) -> Result<NamedList> {
        let file = Self::list_file_name(name).ok_or_else(|| circinus_core::Error::Other("Give the list a name".into()))?;
        let dir = self.named_dir();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(&file);
        let cfg = modsconfig::build(&self.active, &self.mods, &self.game_version.full, &self.previous_known);
        std::fs::write(&path, modsconfig::to_xml(&cfg))?;
        let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
        self.set_current_list(Some(name.clone()));
        Ok(NamedList { name, path, count: cfg.active_mods.len(), updated_at: now(), game_version: self.game_version.full.clone() })
    }

    fn named_path(&self, name: &str) -> Result<PathBuf> {
        let file = Self::list_file_name(name).ok_or_else(|| circinus_core::Error::Other("No such list".into()))?;
        let path = self.named_dir().join(file);
        if !path.is_file() {
            return Err(circinus_core::Error::Other(format!("No list called {name}")));
        }
        Ok(path)
    }

    /// Make a named list the active list (unsaved until `save`) and the current list.
    pub fn load_named_list(&mut self, name: &str) -> Result<(usize, Vec<String>)> {
        let path = self.named_path(name)?;
        let r = self.restore_list(&path)?;
        self.set_current_list(Some(name.to_string()));
        Ok(r)
    }

    pub fn delete_named_list(&mut self, name: &str) -> Result<()> {
        let path = self.named_path(name)?;
        std::fs::remove_file(path)?;
        if self.current_list.as_deref() == Some(name) {
            self.set_current_list(None);
        }
        Ok(())
    }

    pub fn rename_named_list(&mut self, from: &str, to: &str) -> Result<String> {
        let path = self.named_path(from)?;
        let file = Self::list_file_name(to).ok_or_else(|| circinus_core::Error::Other("Give the list a name".into()))?;
        let dest = self.named_dir().join(&file);
        if dest.is_file() && !dest.to_string_lossy().eq_ignore_ascii_case(&path.to_string_lossy()) {
            return Err(circinus_core::Error::Other(format!("There is already a list called {}", file.trim_end_matches(".xml"))));
        }
        std::fs::rename(&path, &dest)?;
        let new_name = file.trim_end_matches(".xml").to_string();
        if self.current_list.as_deref() == Some(from) {
            self.set_current_list(Some(new_name.clone()));
        }
        Ok(new_name)
    }

    /// Stop working on a named list: the active list is ModsConfig.xml only from here on.
    pub fn detach_list(&mut self) {
        self.set_current_list(None);
    }

    /// Delete a mod folder. A link in the Mods folder is removed on its own; the folder it
    /// points at is left alone. Anything else goes to the recycle bin.
    pub fn delete_mod(&mut self, uid: &str) -> Result<String> {
        let m = self.mods.iter().find(|m| m.uid == uid).cloned().ok_or_else(|| circinus_core::Error::Other("No such mod".into()))?;
        if m.source == Source::Ludeon {
            return Err(circinus_core::Error::Other("The game's own content cannot be deleted".into()));
        }
        if m.source == Source::Workshop {
            return Err(circinus_core::Error::Other("Steam owns this folder: unsubscribe on the Workshop page and Steam removes it".into()));
        }
        let what = if m.link_target.is_some() {
            std::fs::remove_dir(&m.path).or_else(|_| std::fs::remove_file(&m.path))?;
            format!("Removed the link {}; the folder it pointed at is untouched", m.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
        } else {
            trash::delete(&m.path).map_err(|e| circinus_core::Error::Other(format!("Could not move the folder to the recycle bin: {e}")))?;
            format!("Moved {} to the recycle bin", m.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())
        };
        let was_active = self.active.iter().any(|u| u == uid);
        self.mods.retain(|x| x.uid != uid);
        self.files.remove(uid);
        self.active.retain(|u| u != uid);
        if was_active {
            self.dirty = true;
        }
        self.recompile();
        Ok(what)
    }

    /// What a "keep a local copy" would copy, and to where.
    ///
    /// Separated from the copying so the app is not locked while thousands of files are written.
    /// Returns the folder to read, the folder to write, the Workshop id and whether the Steam
    /// copy is in the load order right now, since the local one has to take its place.
    pub fn localize_plan(&self, uid: &str) -> Result<(PathBuf, PathBuf, u64, Option<usize>)> {
        let m = self.mods.iter().find(|m| m.uid == uid).ok_or_else(|| circinus_core::Error::Other("No such mod".into()))?;
        if m.source != Source::Workshop {
            return Err(circinus_core::Error::Other(format!("{} is not a Steam Workshop mod, so there is nothing to copy: it is already on your disk to keep", m.name)));
        }
        let id = m.published_file_id.ok_or_else(|| circinus_core::Error::Other(format!("{} has no Workshop id, so Circinus cannot tell which item it is", m.name)))?;
        let mods_dir = self.locations.local_mods_dir.clone().ok_or_else(|| circinus_core::Error::Other("Circinus has not found the game's Mods folder. Settings, Where RimWorld lives, will set it".into()))?;
        let dst = mods_dir.join(id.to_string());
        if dst.exists() {
            return Err(circinus_core::Error::Other(format!("There is already a folder called {id} in Mods. Nothing was copied; look at it before deciding what to do with it")));
        }
        let at = self.active.iter().position(|u| u == uid);
        Ok((circinus_core::fsx::real_root(&m.path), dst, id, at))
    }

    /// Put the copy in the load order where the Steam one was, so the game loads the copy.
    ///
    /// RimWorld's own rule does the rest: with the same packageId in Mods and in the Workshop
    /// folder, the game postfixes the *Workshop* one with `_steam` and the local copy keeps the
    /// plain id. ModsConfig.xml names the plain id, so the copy is what loads and Steam updating
    /// its own folder cannot change what the game reads.
    pub fn localized_took_its_place(&mut self, id: u64, at: Option<usize>) -> Option<String> {
        let new_uid = self.mods.iter().find(|m| m.published_file_id == Some(id) && m.source != Source::Workshop).map(|m| m.uid.clone())?;
        if let Some(i) = at {
            let old = self.active.get(i).cloned();
            self.active[i] = new_uid.clone();
            // The Steam copy may also sit elsewhere in the list; it must not be in it twice.
            if let Some(old) = old {
                self.active.retain(|u| *u == new_uid || *u != old);
            }
            self.dirty = true;
            self.recompile();
        }
        Some(new_uid)
    }

    /// Workshop ids of every installed mod that came from the Workshop or SteamCMD.
    pub fn workshop_ids(&self) -> Vec<(String, u64)> {
        self.mods.iter().filter(|m| updatable(m)).filter_map(|m| m.published_file_id.map(|id| (m.uid.clone(), id))).collect()
    }

    /// Where a Force update of each mod goes (see `update_target`), and the ones refused with
    /// the reason.
    pub fn update_targets(&self, uids: &[String]) -> (Vec<UpdateTarget>, Vec<(u64, String)>) {
        let mut targets = Vec::new();
        let mut refused = Vec::new();
        for m in uids.iter().filter_map(|uid| self.mods.iter().find(|m| &m.uid == uid)) {
            match update_target(m, self.locations.workshop_dir.as_deref()) {
                Ok(t) => targets.push(t),
                Err(why) => refused.push((m.published_file_id.unwrap_or(0), why)),
            }
        }
        (targets, refused)
    }

    /// Bring the update list in line with the mods as they are now; see `still_behind`.
    fn refresh_updates(&mut self) {
        still_behind(&mut self.updates, &self.mods);
    }

    /// Compare Workshop `time_updated` with what is on disk.
    pub fn apply_update_check(&mut self, items: &[WorkshopItem]) -> usize {
        let by_id: HashMap<u64, &WorkshopItem> = items.iter().map(|i| (i.published_file_id, i)).collect();
        let mut out = Vec::new();
        for m in self.mods.iter().filter(|m| updatable(m)) {
            let Some(id) = m.published_file_id else { continue };
            let Some(item) = by_id.get(&id) else { continue };
            if behind(item.time_updated, m) {
                out.push(UpdateInfo { uid: m.uid.clone(), published_file_id: id, name: m.name.clone(), local_modified: m.modified, remote_updated: item.time_updated, source: m.source });
            }
        }
        out.sort_by(|a, b| b.remote_updated.cmp(&a.remote_updated));
        self.updates = out;
        self.updates_checked_at = now();
        self.updates.len()
    }

    /// Resolve package ids that are missing from the install to workshop ids via the Steam DB.
    pub fn workshop_ids_for_missing(&self) -> (Vec<u64>, Vec<String>) {
        let mut ids = Vec::new();
        let mut unresolved = Vec::new();
        for pkg in &self.missing {
            let base = pkg.trim_end_matches("_steam");
            match self.db.steam.workshop_ids_for(base).first() {
                Some(id) => ids.push(*id),
                None => unresolved.push(pkg.clone()),
            }
        }
        (ids, unresolved)
    }

    pub fn description(&self, uid: &str) -> String {
        self.mods.iter().find(|m| m.uid == uid).map(|m| m.description.clone()).unwrap_or_default()
    }

    pub fn set_active(&mut self, uids: Vec<String>) {
        let live: HashSet<&str> = self.mods.iter().map(|m| m.uid.as_str()).collect();
        let mut seen = HashSet::new();
        self.active = uids.into_iter().filter(|u| live.contains(u.as_str()) && seen.insert(u.clone())).collect();
        self.dirty = true;
    }

    pub fn activate(&mut self, uids: &[String], at: Option<usize>) {
        let mut order = self.active.clone();
        let new: Vec<String> = uids.iter().filter(|u| !order.contains(u)).cloned().collect();
        match at {
            Some(i) if i <= order.len() => {
                let tail = order.split_off(i);
                order.extend(new);
                order.extend(tail);
            }
            _ => order.extend(new),
        }
        self.set_active(order);
    }

    pub fn deactivate(&mut self, uids: &[String]) {
        let drop: HashSet<&String> = uids.iter().collect();
        let order: Vec<String> = self.active.iter().filter(|u| !drop.contains(u)).cloned().collect();
        self.set_active(order);
    }

    pub fn halo(&mut self, apply: bool) -> SortResult {
        let result = self.with_context(|ctx| order::sort(&self.active, ctx));
        if apply && result.order != self.active {
            self.active = result.order.clone();
            self.dirty = true;
        }
        result
    }

    pub fn save(&mut self) -> Result<PathBuf> {
        let path = self.locations.mods_config_path().ok_or_else(|| circinus_core::Error::Other("RimWorld's config folder is not set. Choose it in Settings.".into()))?;
        let cfg = modsconfig::build(&self.active, &self.mods, &self.game_version.full, &self.previous_known);
        modsconfig::write(&path, &cfg)?;
        self.dirty = false;
        self.list_reset = None;
        if let Err(e) = modsconfig::archive(&self.lists_dir(), &cfg, "saved", LIST_HISTORY) {
            tracing::warn!("could not archive the list: {e}");
        }
        // The named list being worked on follows the save.
        if let Some(name) = self.current_list.clone() {
            if let Err(e) = self.save_named_list(&name) {
                tracing::warn!("could not update the named list {name}: {e}");
            }
        }
        // Our own edit is not "a change made outside Circinus".
        self.file_active = cfg.active_mods.iter().map(|p| p.to_lowercase()).collect();
        if let Some(b) = &mut self.baseline {
            b.active = self.file_active.clone();
        }
        self.refresh_changes();
        self.store_baseline();
        Ok(path)
    }

    pub fn resolve_import(&self, list: &ImportedList) -> (Vec<String>, Vec<String>) {
        modsconfig::resolve_active(&list.package_ids, &self.mods)
    }

    pub fn persist(&mut self) -> Result<()> {
        self.cache.set("settings", &self.settings)?;
        self.cache.set("user", &self.user)?;
        // The folders and launch settings belong to the instance that is open: keep the two in
        // step so a switch never writes one instance's folders into another.
        instances::sync_current(self)
    }

    /// Where the window was last time, if it was ever closed cleanly.
    pub fn window_state(&self) -> Option<WindowState> {
        self.cache.get(WINDOW_KEY).unwrap_or(None)
    }

    pub fn store_window_state(&self, w: &WindowState) {
        if let Err(e) = self.cache.set(WINDOW_KEY, w) {
            tracing::warn!("could not remember the window: {e}");
        }
    }

    pub fn write_user_rules(&mut self, file: &RulesFile) -> Result<()> {
        let path = rules::user_rules_path(&self.data_dir);
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut f = file.clone();
        f.timestamp = now();
        std::fs::write(&path, serde_json::to_string_pretty(&rules::rules_to_json(&f))?)?;
        self.db.user = f;
        self.recompile();
        Ok(())
    }

    fn load_cached_weights(&mut self) -> Result<()> {
        self.weights_sample = self.cache.get("weights_sample").unwrap_or(None);
        let all: HashMap<String, (Weight, i64)> = self.cache.weights_all()?;
        let mut newest = 0;
        for (id, (w, at)) in all {
            newest = newest.max(at);
            self.weights.insert(id, w);
        }
        self.weights_fetched_at = newest;
        Ok(())
    }

    /// Remember what one record from the API looks like.
    pub fn store_weights_sample(&mut self, sample: Option<serde_json::Value>) {
        let text = sample.map(|v| serde_json::to_string_pretty(&v).unwrap_or_default()).map(|t| if t.len() > 6000 { format!("{}\n...", &t[..6000]) } else { t });
        if let Some(t) = &text {
            let _ = self.cache.set("weights_sample", t);
        }
        self.weights_sample = text;
    }

    /// Merge freshly fetched API weights (and local runs) into the cache.
    pub fn store_weights(&mut self, fetched: Vec<Weight>) -> Result<usize> {
        let at = now();
        let entries: Vec<(String, Weight)> = fetched.into_iter().map(|w| (w.package_id.clone(), w)).collect();
        self.cache.weights_store(&entries, at)?;
        for (id, w) in entries.iter() {
            self.weights.insert(id.clone(), w.clone());
        }
        self.weights_fetched_at = at;
        Ok(entries.len())
    }

    pub fn merge_local_weights(&mut self) -> usize {
        let Some(cfg) = &self.locations.config_dir else { return 0 };
        let dir = weight::local_runs_dir(cfg);
        let local = weight::read_local_runs(&dir).unwrap_or_default();
        let mut n = 0;
        for (id, w) in local {
            // Local figures only fill gaps; published, ranked figures stay authoritative.
            let keep_api = self.weights.get(&id).map(|x| x.origin == "api" && x.share.is_some()).unwrap_or(false);
            if !keep_api {
                self.weights.insert(id, w);
                n += 1;
            }
        }
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Settings saved by a build that predates the update check come up with it on, and a
    /// user who has since turned it off is not overruled by a later migration.
    #[test]
    fn migration_turns_the_update_check_on_once() {
        let stored = r#"{"settingsVersion":2,"listByPhase":false,"checkForUpdates":false}"#;
        let mut s: Settings = serde_json::from_str(stored).unwrap();
        assert!(s.migrate());
        assert!(s.check_for_updates);
        assert_eq!(s.settings_version, SETTINGS_VERSION);
        assert!(!s.list_by_phase, "a version-2 preference is not touched by the version-3 step");
        s.check_for_updates = false;
        assert!(!s.migrate(), "nothing to migrate a second time");
        assert!(!s.check_for_updates);
        // Settings with no such field at all get the default, before any migration runs.
        let fresh: Settings = serde_json::from_str("{}").unwrap();
        assert!(fresh.check_for_updates);
    }

    fn installed(path: &str, source: Source, id: Option<u64>, modified: u64) -> ModInfo {
        ModInfo { uid: path.into(), path: PathBuf::from(path), name: path.into(), source, published_file_id: id, modified, ..Default::default() }
    }

    fn update_for(m: &ModInfo, remote_updated: u64) -> UpdateInfo {
        UpdateInfo { uid: m.uid.clone(), published_file_id: m.published_file_id.unwrap(), name: m.name.clone(), local_modified: m.modified, remote_updated, source: m.source }
    }

    /// A developer's build in Mods carries the Workshop id its repo tracks and must not be offered
    /// an update; a mod Steam updated after the check, or one that has gone, drops off the list.
    #[test]
    fn the_update_list_holds_only_what_is_still_behind() {
        let steam = installed("/ws/1", Source::Workshop, Some(1), 100);
        let ours = installed("/mods/2", Source::SteamCmd, Some(2), 100);
        let dev = installed("/mods/Dev", Source::Local, Some(3), 100);
        let mut updated = installed("/ws/4", Source::Workshop, Some(4), 100);
        let gone = installed("/mods/5", Source::SteamCmd, Some(5), 100);
        let mut updates: Vec<UpdateInfo> = [&steam, &ours, &dev, &updated, &gone].iter().map(|m| update_for(m, 1_000)).collect();
        updated.modified = 2_000;
        still_behind(&mut updates, &[steam, ours, dev, updated]);
        assert_eq!(updates.iter().map(|u| u.published_file_id).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn force_update_targets_the_folder_the_mod_is_in() {
        let ws = PathBuf::from("/lib/steamapps/workshop/content/294100");
        let steam = installed(&ws.join("7").to_string_lossy(), Source::Workshop, Some(7), 0);
        assert_eq!(update_target(&steam, Some(&ws)), Ok((7, Some(ws.join("7").display().to_string()))));
        assert!(update_target(&steam, None).is_err(), "with no Workshop folder there is no telling where Steam keeps it");
        assert_eq!(update_target(&installed("/game/Mods/8", Source::SteamCmd, Some(8), 0), Some(&ws)), Ok((8, None)));
        for source in [Source::Local, Source::Git] {
            assert!(update_target(&installed("/game/Mods/Dev", source, Some(9), 0), Some(&ws)).is_err(), "{source:?} folders are never updated");
        }
        assert!(update_target(&installed("/game/Mods/Plain", Source::SteamCmd, None, 0), Some(&ws)).is_err());
    }

    fn write(p: &std::path::Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    /// A small game folder with Core, one DLC and two mods, and an App opened on it.
    fn app_on_fixture() -> (tempfile::TempDir, App) {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("game");
        write(&game.join("Version.txt"), "1.6.4530 rev1235");
        write(&game.join("Data/Core/About/About.xml"), "<ModMetaData><packageId>Ludeon.RimWorld</packageId></ModMetaData>");
        write(&game.join("Data/Royalty/About/About.xml"), "<ModMetaData><packageId>Ludeon.RimWorld.Royalty</packageId></ModMetaData>");
        write(&game.join("Mods/Harmony/About/About.xml"), "<ModMetaData><packageId>brrainz.harmony</packageId><name>Harmony</name><supportedVersions><li>1.6</li></supportedVersions></ModMetaData>");
        write(&game.join("Mods/Walls/About/About.xml"), "<ModMetaData><packageId>nyx.retrowalls</packageId><name>Walls</name><supportedVersions><li>1.6</li></supportedVersions></ModMetaData>");
        write(&game.join("Config/ModsConfig.xml"), "<ModsConfigData><version>1.6.4530 rev1235</version><activeMods><li>ludeon.rimworld</li><li>brrainz.harmony</li></activeMods><knownExpansions></knownExpansions></ModsConfigData>");
        let mut settings = Settings::default();
        settings.locations.game_dir = Some(game.clone());
        settings.locations.config_dir = Some(game.join("Config"));
        settings.locations.local_mods_dir = Some(game.join("Mods"));
        let mut app = App::open_at(tmp.path().join("data"), Some(settings)).unwrap();
        let shallow = app.scan_quick(true, &|_, _| {}).unwrap();
        let ins = circinus_core::scan::inspect_mods(&shallow, &|_, _| {});
        app.apply_inspections(ins).unwrap();
        (tmp, app)
    }

    #[test]
    fn named_lists_round_trip_and_follow_save() {
        let (_tmp, mut app) = app_on_fixture();
        assert_eq!(app.active.len(), 2);
        let uid = |app: &App, id: &str| app.mods.iter().find(|m| m.package_id == id).unwrap().uid.clone();
        let walls = uid(&app, "nyx.retrowalls");
        let harmony = uid(&app, "brrainz.harmony");
        // Save the list as "Vanilla+", add a mod, save the game config: the named list follows.
        let saved = app.save_named_list("Vanilla+").unwrap();
        assert_eq!(saved.name, "Vanilla+");
        assert_eq!(saved.count, 2);
        assert_eq!(app.current_list.as_deref(), Some("Vanilla+"));
        app.activate(&[walls.clone()], None);
        app.save().unwrap();
        let lists = app.named_lists();
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].count, 3, "Save updates the list being worked on");
        // Another list, then switch back and forth.
        app.deactivate(&[walls.clone(), harmony.clone()]);
        app.save_named_list("Bare: core only").unwrap();
        assert_eq!(app.named_lists().len(), 2);
        let (n, missing) = app.load_named_list("Vanilla+").unwrap();
        assert_eq!((n, missing.len()), (3, 0));
        assert!(app.dirty, "loading a list is an unsaved change until Save");
        assert_eq!(app.current_list.as_deref(), Some("Vanilla+"));
        // Rename, detach, delete.
        assert_eq!(app.rename_named_list("Vanilla+", "Vanilla plus").unwrap(), "Vanilla plus");
        assert_eq!(app.current_list.as_deref(), Some("Vanilla plus"));
        assert!(app.rename_named_list("Vanilla plus", "Bare: core only").is_err(), "no overwriting another list");
        app.detach_list();
        assert!(app.current_list.is_none());
        app.delete_named_list("Bare: core only").unwrap();
        assert_eq!(app.named_lists().len(), 1);
        assert!(app.load_named_list("Bare: core only").is_err());
        // Names get file-safe; reopening the app remembers the current list.
        app.save_named_list("odd / name: v2?").unwrap();
        assert_eq!(app.current_list.as_deref(), Some("odd - name- v2-"));
        let again = App::open_at(app.data_dir.clone(), None).unwrap();
        assert_eq!(again.current_list.as_deref(), Some("odd - name- v2-"));
        assert!(App::list_file_name("   ").is_none());
    }

    #[test]
    fn deleting_a_mod_removes_a_link_but_keeps_its_target() {
        let (tmp, mut app) = app_on_fixture();
        let work = tmp.path().join("work").join("linked");
        write(&work.join("About/About.xml"), "<ModMetaData><packageId>x.linked</packageId><name>Linked</name></ModMetaData>");
        let link = tmp.path().join("game").join("Mods").join("deadbeef");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&work, &link).unwrap();
        #[cfg(windows)]
        {
            // A junction needs no privilege on Windows; a symlink would. mklink is a cmd builtin, so
            // it has to go through cmd, and cmd reads a leading / as a switch: a path carrying forward
            // slashes, which Rust's own file APIs take happily, arrives here as "Invalid switch".
            let native = |p: &std::path::Path| p.to_string_lossy().replace('/', "\\");
            let out = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(native(&link)).arg(native(&work)).output().unwrap();
            assert!(out.status.success(), "mklink {} {}: {}{}", native(&link), native(&work), String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        }
        let shallow = app.scan_quick(false, &|_, _| {}).unwrap();
        app.apply_inspections(circinus_core::scan::inspect_mods(&shallow, &|_, _| {})).unwrap();
        let uid = app.mods.iter().find(|m| m.package_id == "x.linked").unwrap().uid.clone();
        app.activate(std::slice::from_ref(&uid), None);
        let what = app.delete_mod(&uid).unwrap();
        assert!(what.contains("link"), "{what}");
        assert!(!link.exists() && std::fs::symlink_metadata(&link).is_err(), "the link is gone");
        assert!(work.join("About/About.xml").is_file(), "the folder it pointed at is untouched");
        assert!(app.mods.iter().all(|m| m.uid != uid));
        assert!(app.active.iter().all(|u| *u != uid));
        assert!(app.dirty);
        let core = app.mods.iter().find(|m| m.source == Source::Ludeon).unwrap().uid.clone();
        assert!(app.delete_mod(&core).is_err(), "official content stays");
    }

    /// Groups you delete stay deleted. They came back on every launch, because "no groups" and
    /// "never had any" were the same state and an empty list was read as the second.
    #[test]
    fn deleting_every_group_is_a_decision_that_sticks() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        let mut app = App::open_at(data.clone(), Some(Settings::default())).unwrap();
        assert_eq!(app.user.groups.len(), 5, "a fresh install is given somewhere to start");

        app.user.groups.clear();
        app.persist().unwrap();
        let again = App::open_at(data.clone(), Some(Settings::default())).unwrap();
        assert!(again.user.groups.is_empty(), "the groups came back after being deleted");

        // And once more, since a bug like this is usually a thing that happens every launch
        // rather than only the next one.
        let third = App::open_at(data.clone(), Some(Settings::default())).unwrap();
        assert!(third.user.groups.is_empty());

        // Deleting some of them is not deleting all of them.
        let mut app4 = App::open_at(tmp.path().join("other"), Some(Settings::default())).unwrap();
        app4.user.groups.retain(|g| g.id == "core");
        app4.persist().unwrap();
        let back = App::open_at(tmp.path().join("other"), Some(Settings::default())).unwrap();
        assert_eq!(back.user.groups.len(), 1, "the four that were deleted came back");
        assert_eq!(back.user.groups[0].id, "core");
    }

    /// Fresh data gets the self-filling default groups; an existing install adopts them once,
    /// except where the user already put mods in by hand, and a later switch back sticks.
    #[test]
    fn default_groups_fill_themselves_and_existing_installs_adopt_once() {
        let (_tmp, app) = app_on_fixture();
        let core = app.user.groups.iter().find(|g| g.id == "core").unwrap();
        assert_eq!(core.auto, Some(AutoRule::Official));
        assert_eq!(app.user.groups.iter().find(|g| g.id == "performance").unwrap().auto, Some(AutoRule::Phase { phase: Phase::Optimization }));
        assert!(app.user.groups.iter().find(|g| g.id == "qol").unwrap().auto.is_none());
        assert!(app.user.auto_groups_adopted);
        // An older install: groups without the field, Frameworks used by hand.
        let mut old = UserData { groups: default_groups().into_iter().map(|g| Group { auto: None, ..g }).collect(), ..Default::default() };
        old.mod_groups.insert("some/mod".into(), "frameworks".into());
        adopt_auto_groups(&mut old);
        assert_eq!(old.groups.iter().find(|g| g.id == "core").unwrap().auto, Some(AutoRule::Official));
        assert!(old.groups.iter().find(|g| g.id == "frameworks").unwrap().auto.is_none(), "hand-picked members: left alone");
        // The user switches Core back to hand-picked; reopening does not undo it.
        let tmp2 = tempfile::tempdir().unwrap();
        let mut app2 = App::open_at(tmp2.path().join("data"), Some(Settings::default())).unwrap();
        app2.user.groups.iter_mut().find(|g| g.id == "core").unwrap().auto = None;
        app2.persist().unwrap();
        let again = App::open_at(tmp2.path().join("data"), Some(Settings::default())).unwrap();
        assert!(again.user.groups.iter().find(|g| g.id == "core").unwrap().auto.is_none());
        // The rule survives the wire format.
        let json = serde_json::to_string(&AutoRule::Author { name: "Oskar".into() }).unwrap();
        assert_eq!(json, r#"{"kind":"author","name":"Oskar"}"#);
        assert_eq!(serde_json::to_string(&AutoRule::Phase { phase: Phase::Framework }).unwrap(), r#"{"kind":"phase","phase":"framework"}"#);
    }

    #[test]
    fn collection_changes_are_measured_from_the_last_review() {
        let mut c = TrackedCollection { id: 1, items: vec![10, 20, 30], known: vec![10, 20, 30], ..Default::default() };
        assert!(c.added().is_empty() && c.removed().is_empty());
        c.items = vec![10, 30, 40];
        assert_eq!(c.added(), vec![40]);
        assert_eq!(c.removed(), vec![20]);
        c.known = c.items.clone();
        assert!(c.added().is_empty() && c.removed().is_empty());
    }
}

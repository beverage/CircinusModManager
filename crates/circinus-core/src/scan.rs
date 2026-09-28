//! Discover and parse installed mods from the three roots RimWorld reads:
//! `<game>/Data`, `<game>/Mods` and the Workshop content folder.

use crate::about::{parse_about, parse_load_folders, parse_manifest};
use crate::cache::Cache;
use crate::fsx::{folder_at, real_root, rel_str, walk};
use crate::game::GameVersion;
use crate::model::*;
use crate::paths::Locations;
use crate::xmlutil::read_text;
use crate::Result;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;

/// Bump when the parser changes so cached entries are re-parsed.
// 5: `ModInfo::updated` carries Steam's timeupdated on its own. A cached row from 4 has no such
// field and would deserialize as "never updated", which is a wrong answer rather than a missing
// one, so every mod is read again once.
// 6: a local folder counts as a SteamCMD download only when it is named after its Workshop id.
// Rows cached by 5 may mark a dev build as one, and would keep doing so.
const PARSER_VERSION: u32 = 6;

/// File inventory kept out of `ModInfo` (too large for the UI): relative paths from the mod
/// root, lowercase, forward slashes. Textures are stored without extension because RimWorld
/// resolves them that way (`Wall_Atlas.png` and `Wall_Atlas.dds` are the same texture).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFiles {
    pub textures: Vec<String>,
    pub patches: Vec<String>,
    pub defs: Vec<String>,
    pub assemblies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub locations: Locations,
    pub game_version: GameVersion,
    pub use_cache: bool,
    /// Workshop id → Steam's `timeupdated` from `appworkshop_294100.acf`. Steam can replace
    /// files deep inside an item without touching the folder's mtime, so this is part of the
    /// cache stamp and of `ModInfo::modified` for Workshop items.
    #[serde(default)]
    pub workshop_updated: HashMap<u64, u64>,
}

#[derive(Debug, Default)]
pub struct ScanOutput {
    pub mods: Vec<ModInfo>,
    pub files: HashMap<String, ModFiles>,
    pub from_cache: usize,
    pub parsed: usize,
    /// uids whose folders have not been walked yet (quick scan). Pass them to `inspect_mods`.
    pub shallow: Vec<String>,
    /// uid → cache stamp for entries not yet written to the cache.
    pub stamps: HashMap<String, String>,
    /// Entries in a mod folder that could not be read as folders: links to nowhere, links
    /// of a kind this platform cannot open. Files are not listed.
    pub unreadable: Vec<Unreadable>,
}

/// A Mods folder entry the scan had to leave out, with the reason in plain words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unreadable {
    pub path: PathBuf,
    pub reason: String,
}

/// Result of walking one mod folder.
#[derive(Debug, Clone)]
pub struct Inspection {
    pub uid: String,
    pub contents: Contents,
    pub files: ModFiles,
    pub modified: u64,
}

#[derive(Serialize, Deserialize)]
struct CachedEntry {
    info: ModInfo,
    files: ModFiles,
}

fn mtime_secs(md: &std::fs::Metadata) -> u64 {
    md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

/// Case-insensitive lookup of a direct child entry. A link is resolved to what it points at.
fn find_entry(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.exists() {
        return Some(real_root(&direct));
    }
    let rd = std::fs::read_dir(dir).ok()?;
    rd.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| p.file_name().map(|f| f.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false)).map(|p| real_root(&p))
}

struct Candidate {
    /// The entry in the mod folder, the path RimWorld reports; the mod's uid.
    path: PathBuf,
    /// Where the files really are: `path` itself, or the target when `path` is a link.
    real: PathBuf,
    source: Source,
    about_xml: Option<PathBuf>,
    stamp: String,
    /// Newest of the cheap signals: folder mtime, About.xml mtime, Steam's timeupdated.
    modified: u64,
    /// Steam's timeupdated on its own, 0 when this is not a Workshop item.
    updated: u64,
}

fn candidates_in(root: &Path, source: Source, game_version: &str, workshop_updated: &HashMap<u64, u64>, unreadable: &mut Vec<Unreadable>) -> Vec<Candidate> {
    let Ok(rd) = std::fs::read_dir(root) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in rd.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if name.starts_with('.') || name.eq_ignore_ascii_case("__MACOSX") {
            continue;
        }
        // The entry's own type comes free with the listing. A plain folder is used as is; a
        // link (a symlink, or a junction on Windows) is read through to the folder it names,
        // because RimWorld loads the mod behind it and because opening a link and letting the
        // OS follow it fails on some Windows setups.
        let kind = entry.file_type().ok();
        let real = if kind.map(|t| t.is_dir()).unwrap_or(false) {
            path.clone()
        } else if kind.map(|t| t.is_file()).unwrap_or(false) {
            continue;
        } else {
            match folder_at(&path) {
                Ok(real) => real,
                Err(reason) => {
                    tracing::warn!(path = %path.display(), %reason, "mod folder entry left out");
                    unreadable.push(Unreadable { path, reason });
                    continue;
                }
            }
        };
        let about_dir = find_entry(&real, "About");
        let about_xml = about_dir.as_ref().and_then(|d| find_entry(d, "About.xml"));
        let dir_mtime = std::fs::metadata(&real).map(|m| mtime_secs(&m)).unwrap_or(0);
        let about_mtime = about_xml.as_ref().and_then(|p| std::fs::metadata(p).ok()).map(|m| mtime_secs(&m)).unwrap_or(0);
        // Workshop folders are named after the item id; Steam's own record of when it last
        // updated the item is the only reliable sign of an in-place update.
        let ws_updated = if source == Source::Workshop { name.parse::<u64>().ok().and_then(|id| workshop_updated.get(&id).copied()).unwrap_or(0) } else { 0 };
        let stamp = if ws_updated > 0 { format!("{PARSER_VERSION}:{game_version}:{dir_mtime}:{about_mtime}:{ws_updated}") } else { format!("{PARSER_VERSION}:{game_version}:{dir_mtime}:{about_mtime}") };
        out.push(Candidate { source, path, real, about_xml, stamp, modified: dir_mtime.max(about_mtime).max(ws_updated), updated: ws_updated });
    }
    out
}

/// Walk a mod folder once: counts, sizes, newest mtime and the file inventory. `root` may be a
/// link, and so may folders inside; both are read through.
fn inspect_folder(root: &Path) -> (Contents, ModFiles, u64) {
    let mut c = Contents::default();
    let mut f = ModFiles::default();
    let mut newest = 0u64;
    let mut language_dirs = std::collections::HashSet::new();
    // Textures the game would decode: PNG/JPG without a DDS of the same name. Collected
    // during the walk, sized from their headers after it, once the DDS set is complete.
    let mut pngs: Vec<(String, PathBuf, u64)> = Vec::new();
    let mut dds_stems: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut patch_files: Vec<PathBuf> = Vec::new();
    let found = walk(root, &|n| n == ".git" || n.eq_ignore_ascii_case("Source") || n == ".vs" || n.eq_ignore_ascii_case("obj"));
    for entry in &found {
        let md = &entry.meta;
        newest = newest.max(mtime_secs(md));
        if !md.is_file() {
            continue;
        }
        c.size_bytes += md.len();
        let rel = entry.rel.as_path();
        let rel_s = rel_str(rel).to_ascii_lowercase();
        let segs: Vec<&str> = rel_s.split('/').collect();
        let ext = rel.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        let has_seg = |s: &str| segs[..segs.len().saturating_sub(1)].iter().any(|x| *x == s);
        if has_seg("assemblies") && ext == "dll" {
            c.assemblies += 1;
            c.load.dll_bytes += md.len();
            if segs.last().map(|n| *n == "0harmony.dll").unwrap_or(false) {
                c.bundles_harmony = true;
            }
            f.assemblies.push(rel_s.clone());
        } else if has_seg("patches") && ext == "xml" {
            c.patches += 1;
            c.load.patch_bytes += md.len();
            patch_files.push(entry.path.clone());
            f.patches.push(rel_s.clone());
        } else if has_seg("defs") && ext == "xml" {
            c.defs += 1;
            c.load.def_bytes += md.len();
            f.defs.push(rel_s.clone());
        } else if has_seg("textures") && matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "dds" | "psd") {
            let stem = match rel_s.rfind('.') {
                Some(i) => rel_s[..i].to_string(),
                None => rel_s.clone(),
            };
            if ext == "dds" {
                c.dds += 1;
                c.load.dds_bytes += md.len();
                dds_stems.insert(stem.clone());
            } else {
                c.textures += 1;
                pngs.push((stem.clone(), entry.path.clone(), md.len()));
            }
            if !f.textures.last().map(|l| *l == stem).unwrap_or(false) {
                f.textures.push(stem);
            }
        } else if has_seg("sounds") && matches!(ext.as_str(), "wav" | "ogg" | "mp3") {
            c.sounds += 1;
            c.load.sound_bytes += md.len();
        } else if let Some(i) = segs.iter().position(|s| *s == "languages") {
            if let Some(lang) = segs.get(i + 1) {
                language_dirs.insert(lang.to_string());
            }
        }
    }
    f.textures.sort();
    f.textures.dedup();
    c.languages = language_dirs.len() as u32;
    for (stem, path, bytes) in pngs {
        if dds_stems.contains(&stem) {
            continue;
        }
        c.load.png_bytes += bytes;
        c.load.png_pixels += crate::loadcost::image_pixels(&path).unwrap_or_else(|| crate::loadcost::pixels_from_bytes(bytes));
    }
    for p in patch_files {
        if let Ok(xml) = std::fs::read_to_string(&p) {
            let (ops, heavy) = crate::loadcost::count_patch_ops(&xml);
            c.load.patch_ops += ops;
            c.load.heavy_ops += heavy;
        }
    }
    crate::loadcost::finish(&mut c);
    (c, f, newest)
}

fn read_published_file_id(about_dir: Option<&Path>, folder: &Path) -> Option<u64> {
    if let Some(p) = about_dir.and_then(|d| find_entry(d, "PublishedFileId.txt")) {
        if let Ok(t) = read_text(&p) {
            let digits: String = t.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(v) = digits.parse::<u64>() {
                if v > 0 {
                    return Some(v);
                }
            }
        }
    }
    folder.file_name().and_then(|n| n.to_string_lossy().parse::<u64>().ok()).filter(|v| *v > 0)
}

fn classify(info: &ModInfo) -> ModKind {
    let c = &info.contents;
    if info.source == Source::Ludeon {
        return ModKind::Official;
    }
    if info.invalid.as_deref().map(|r| r.starts_with("Scenario")).unwrap_or(false) {
        return ModKind::Scenario;
    }
    if c.assemblies > 0 {
        return ModKind::Code;
    }
    if c.languages > 0 && c.defs == 0 && c.patches == 0 && c.textures + c.dds == 0 {
        return ModKind::Translation;
    }
    if c.textures + c.dds > 0 && c.defs == 0 && c.patches == 0 {
        return ModKind::Textures;
    }
    if c.defs + c.patches > 0 {
        return ModKind::Xml;
    }
    ModKind::Unknown
}

/// Everything that can be known from `About/` alone — no folder walk. `contents` stays empty and
/// `kind` is Unknown until `inspect_mods` fills them in.
fn parse_quick(c: &Candidate, gv: &GameVersion) -> ModInfo {
    let uid = c.path.to_string_lossy().to_string();
    let about_dir = c.about_xml.as_ref().and_then(|p| p.parent().map(|p| p.to_path_buf()));
    let mut info = ModInfo { uid: uid.clone(), path: c.path.clone(), source: c.source, ..Default::default() };
    info.link_target = (c.real != c.path).then(|| c.real.clone());
    info.modified = c.modified;
    info.updated = c.updated;

    match &c.about_xml {
        Some(about_path) => match read_text(about_path).and_then(|t| parse_about(&t, about_path, &gv.major_minor)) {
            Ok(a) => {
                info.package_id = a.package_id;
                info.name = a.name;
                info.authors = a.authors;
                info.description = a.description;
                info.supported_versions = a.supported_versions;
                info.mod_version = a.mod_version;
                info.url = a.url;
                info.steam_app_id = a.steam_app_id;
                info.rules = a.rules;
            }
            Err(e) => {
                info.invalid = Some(format!("About.xml could not be read: {e}"));
            }
        },
        None => {
            let rsc = std::fs::read_dir(&c.real)
                .ok()
                .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|e| e == "rsc").unwrap_or(false)).collect::<Vec<_>>())
                .unwrap_or_default();
            if rsc.len() == 1 {
                info.name = rsc[0].file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                info.invalid = Some("Scenario file, not a mod".into());
            } else {
                info.invalid = Some("No About/About.xml in this folder".into());
            }
        }
    }

    if info.source == Source::Ludeon {
        if let Some(n) = official_name(&info.package_id) {
            if info.name.is_empty() {
                info.name = n.to_string();
            }
        }
        if info.name.is_empty() {
            info.name = c.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        }
        if info.authors.is_empty() {
            info.authors.push("Ludeon Studios".into());
        }
        if info.supported_versions.is_empty() {
            info.supported_versions.push(gv.major_minor.clone());
        }
        if info.steam_app_id.is_none() {
            info.steam_app_id = OFFICIAL.iter().find(|(_, p, _)| *p == info.package_id).map(|(a, _, _)| *a);
        }
    }
    if info.name.is_empty() {
        info.name = if !info.package_id.is_empty() { info.package_id.clone() } else { c.path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() };
    }
    info.published_file_id = if info.source == Source::Ludeon { None } else { read_published_file_id(about_dir.as_deref(), &c.path) };
    // A git checkout stays a git checkout even when the author's PublishedFileId.txt is in
    // it; only then does the file mark a SteamCMD download.
    if info.source == Source::Local && c.real.join(".git").exists() {
        info.source = Source::Git;
    }
    // The file alone is not enough either. Every build of a published mod carries it, so a dev
    // build would count as a download, be listed as out of date, and be offered Force update.
    // SteamCMD downloads and Keep my own copy always create a real folder named after the
    // Workshop id, so that is what counts.
    let named_for_item = info.published_file_id.is_some_and(|id| c.path.file_name().is_some_and(|n| n.to_string_lossy() == id.to_string()));
    if info.source == Source::Local && named_for_item && c.real == c.path && about_dir.as_ref().and_then(|d| find_entry(d, "PublishedFileId.txt")).is_some() {
        info.source = Source::SteamCmd;
    }
    info.preview = about_dir.as_ref().and_then(|d| find_entry(d, "Preview.png"));
    if let Some(mp) = about_dir.as_ref().and_then(|d| find_entry(d, "Manifest.xml")) {
        if let Ok(m) = read_text(&mp).and_then(|t| parse_manifest(&t, &mp)) {
            info.manifest = Some(m);
        }
    }
    if let Some(lf) = find_entry(&c.real, "LoadFolders.xml") {
        if let Ok(Some(folders)) = read_text(&lf).and_then(|t| parse_load_folders(&t, &lf, &gv.major_minor)) {
            info.load_folders = Some(folders);
        }
    }
    info.kind = classify(&info);
    info
}

/// Walk one mod folder (the slow part) and return what it contains.
pub fn inspect_one(info: &ModInfo) -> Inspection {
    let (contents, files, newest) = inspect_folder(&info.path);
    Inspection { uid: info.uid.clone(), contents, files, modified: newest.max(info.modified) }
}

/// Walk many mod folders in parallel. `progress(done, total)` is called from worker threads.
pub fn inspect_mods(mods: &[ModInfo], progress: &(dyn Fn(usize, usize) + Sync)) -> Vec<Inspection> {
    let total = mods.len();
    let done = AtomicUsize::new(0);
    mods.par_iter()
        .map(|m| {
            let r = inspect_one(m);
            progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            r
        })
        .collect()
}

/// Merge inspections into a mod list, re-classify, and write the finished entries to the cache.
pub fn apply_inspections(mods: &mut [ModInfo], files: &mut HashMap<String, ModFiles>, stamps: &HashMap<String, String>, inspections: Vec<Inspection>, cache: Option<&Cache>) -> Result<usize> {
    let mut to_store: Vec<(String, String, String)> = Vec::new();
    for ins in inspections {
        let Some(m) = mods.iter_mut().find(|m| m.uid == ins.uid) else { continue };
        m.contents = ins.contents;
        m.modified = ins.modified;
        m.kind = classify(m);
        if let Some(stamp) = stamps.get(&m.uid) {
            if let Ok(json) = serde_json::to_string(&CachedEntry { info: m.clone(), files: ins.files.clone() }) {
                to_store.push((m.uid.clone(), stamp.clone(), json));
            }
        }
        files.insert(ins.uid, ins.files);
    }
    let n = to_store.len();
    if let Some(c) = cache {
        if !to_store.is_empty() {
            c.store_mod_entries(&to_store)?;
        }
    }
    Ok(n)
}

/// Scan all roots. With `deep` false, folders that are not in the cache are only read from
/// `About/` (fast) and listed in `ScanOutput::shallow` for a later `inspect_mods` pass; with
/// `deep` true everything is walked here. `progress(done, total)` is called from worker threads.
pub fn scan(opts: &ScanOptions, cache: Option<&Cache>, deep: bool, progress: &(dyn Fn(usize, usize) + Sync)) -> Result<ScanOutput> {
    let started = std::time::Instant::now();
    let loc = &opts.locations;
    let gv = &opts.game_version;
    let mut cands: Vec<Candidate> = Vec::new();
    let mut unreadable = Vec::new();
    if let Some(data) = loc.data_dir() {
        cands.extend(candidates_in(&data, Source::Ludeon, &gv.major_minor, &opts.workshop_updated, &mut unreadable));
    }
    if let Some(local) = &loc.local_mods_dir {
        cands.extend(candidates_in(local, Source::Local, &gv.major_minor, &opts.workshop_updated, &mut unreadable));
    }
    if let Some(ws) = &loc.workshop_dir {
        cands.extend(candidates_in(ws, Source::Workshop, &gv.major_minor, &opts.workshop_updated, &mut unreadable));
    }
    let total = cands.len();
    let cached: HashMap<String, (String, String)> = match (opts.use_cache, cache) {
        (true, Some(c)) => c.load_mod_entries()?,
        _ => HashMap::new(),
    };
    let done = AtomicUsize::new(0);
    // (info, files, from_cache, inspected)
    let results: Vec<(ModInfo, ModFiles, bool, bool)> = cands
        .par_iter()
        .map(|c| {
            let uid = c.path.to_string_lossy().to_string();
            let hit = cached.get(&uid).filter(|(stamp, _)| *stamp == c.stamp).and_then(|(_, json)| serde_json::from_str::<CachedEntry>(json).ok());
            let out = match hit {
                Some(e) => (e.info, e.files, true, true),
                None => {
                    let mut info = parse_quick(c, gv);
                    if deep {
                        let ins = inspect_one(&info);
                        info.contents = ins.contents;
                        info.modified = ins.modified;
                        info.kind = classify(&info);
                        (info, ins.files, false, true)
                    } else {
                        (info, ModFiles::default(), false, false)
                    }
                }
            };
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            progress(n, total);
            out
        })
        .collect();

    let mut out = ScanOutput { unreadable, ..Default::default() };
    let mut to_store: Vec<(String, String, String)> = Vec::new();
    for ((info, files, from_cache, inspected), cand) in results.into_iter().zip(cands.iter()) {
        if from_cache {
            out.from_cache += 1;
        } else {
            out.parsed += 1;
            out.stamps.insert(info.uid.clone(), cand.stamp.clone());
            if inspected {
                if let Ok(json) = serde_json::to_string(&CachedEntry { info: info.clone(), files: files.clone() }) {
                    to_store.push((info.uid.clone(), cand.stamp.clone(), json));
                }
            } else {
                out.shallow.push(info.uid.clone());
            }
        }
        out.files.insert(info.uid.clone(), files);
        out.mods.push(info);
    }
    if let Some(c) = cache {
        if !to_store.is_empty() {
            c.store_mod_entries(&to_store)?;
        }
        let live: Vec<&str> = out.mods.iter().map(|m| m.uid.as_str()).collect();
        c.prune_mod_entries(&live)?;
    }
    // A folder can only be one mod; if two roots overlap (junctions, a Mods folder pointed at
    // the Workshop), keep the first sighting so every uid is unique.
    let mut seen_uids = std::collections::HashSet::new();
    out.mods.retain(|m| seen_uids.insert(m.uid.clone()));
    out.mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let linked = out.mods.iter().filter(|m| m.link_target.is_some()).count();
    tracing::info!(mods = out.mods.len(), linked, unreadable = out.unreadable.len(), from_cache = out.from_cache, parsed = out.parsed, shallow = out.shallow.len(), ms = started.elapsed().as_millis() as u64, "scan");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(p: &Path, s: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, s).unwrap();
    }

    fn fixture_game(dir: &Path) -> Locations {
        write(&dir.join("Version.txt"), "1.6.4530 rev1235");
        write(&dir.join("Data/Core/About/About.xml"), "<ModMetaData><packageId>Ludeon.RimWorld</packageId></ModMetaData>");
        write(&dir.join("Data/Royalty/About/About.xml"), "<ModMetaData><packageId>Ludeon.RimWorld.Royalty</packageId><steamAppId>1149640</steamAppId></ModMetaData>");
        // A SteamCMD download: named after the item, with the id file SteamCMD mods carry.
        write(
            &dir.join("Mods/2009463077/About/About.xml"),
            "<ModMetaData><packageId>brrainz.harmony</packageId><name>Harmony</name><author>Brrainz</author><supportedVersions><li>1.5</li><li>1.6</li></supportedVersions></ModMetaData>",
        );
        write(&dir.join("Mods/2009463077/About/PublishedFileId.txt"), "2009463077\n");
        write(&dir.join("Mods/2009463077/Current/Assemblies/0Harmony.dll"), "x");
        write(&dir.join("Mods/2009463077/Current/Assemblies/HarmonyMod.dll"), "x");
        write(
            &dir.join("Mods/Walls/About/About.xml"),
            "<ModMetaData><packageId>nyx.retrowalls</packageId><name>Retro Wall Textures</name><supportedVersions><li>1.6</li></supportedVersions></ModMetaData>",
        );
        write(&dir.join("Mods/Walls/Textures/Things/Building/Linked/Wall_Atlas.png"), "png");
        write(&dir.join("Mods/Walls/Textures/Things/Building/Linked/Wall_Atlas.dds"), "dds");
        write(&dir.join("Mods/Walls/LoadFolders.xml"), "<loadFolders><v1.6><li>/</li><li>1.6</li></v1.6></loadFolders>");
        write(&dir.join("Mods/Junk/readme.txt"), "not a mod");
        Locations { game_dir: Some(dir.to_path_buf()), config_dir: None, local_mods_dir: Some(dir.join("Mods")), workshop_dir: None }
    }

    #[test]
    fn scans_and_classifies() {
        let tmp = tempfile::tempdir().unwrap();
        let loc = fixture_game(tmp.path());
        let opts = ScanOptions { locations: loc, game_version: GameVersion::parse("1.6.4530 rev1235").unwrap(), use_cache: false, workshop_updated: HashMap::new() };
        let out = scan(&opts, None, true, &|_, _| {}).unwrap();
        let by_id = |id: &str| out.mods.iter().find(|m| m.package_id == id).unwrap();
        let core = by_id("ludeon.rimworld");
        assert_eq!(core.name, "RimWorld");
        assert_eq!(core.source, Source::Ludeon);
        assert_eq!(core.kind, ModKind::Official);
        let royalty = by_id("ludeon.rimworld.royalty");
        assert_eq!(royalty.steam_app_id, Some(1149640));
        let harmony = by_id("brrainz.harmony");
        assert_eq!(harmony.source, Source::SteamCmd);
        assert_eq!(harmony.published_file_id, Some(2009463077));
        assert_eq!(harmony.contents.assemblies, 2);
        assert!(harmony.contents.bundles_harmony);
        assert_eq!(harmony.kind, ModKind::Code);
        let walls = by_id("nyx.retrowalls");
        assert_eq!(walls.kind, ModKind::Textures);
        assert_eq!(walls.contents.textures, 1);
        assert_eq!(walls.contents.dds, 1);
        assert_eq!(out.files[&walls.uid].textures, vec!["textures/things/building/linked/wall_atlas"]);
        assert_eq!(walls.load_folders.as_ref().unwrap().len(), 2);
        let junk = out.mods.iter().find(|m| m.name == "Junk").unwrap();
        assert!(junk.invalid.is_some());
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }
    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        // A junction needs no privilege on Windows; a symlink would. mklink is a cmd builtin, so
        // it has to go through cmd, and cmd reads a leading / as a switch: a path carrying forward
        // slashes, which Rust's own file APIs take happily, arrives here as "Invalid switch".
        let native = |p: &Path| p.to_string_lossy().replace('/', "\\");
        let out = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(native(link)).arg(native(target)).output().unwrap();
        assert!(out.status.success(), "mklink {} {}: {}{}", native(link), native(target), String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    }

    /// A path built for comparing against one the code produced. On Windows "a/b" and "a\\b" are
    /// the same path but not the same string, and what comes back from the filesystem carries
    /// the platform's own separator; anything asserted against it has to be built the same way.
    fn at(base: &std::path::Path, rel: &str) -> std::path::PathBuf {
        rel.split('/').fold(base.to_path_buf(), |p, part| p.join(part))
    }

    /// Every build of a published mod carries its `PublishedFileId.txt`, so the file alone does
    /// not make a folder a download. A dev build, or a link named after the Workshop id, stays
    /// Local and keeps its id. Only a real folder named after the id counts.
    #[test]
    fn only_a_real_folder_named_after_its_item_is_a_download() {
        let tmp = tempfile::tempdir().unwrap();
        let loc = fixture_game(tmp.path());
        write(
            &tmp.path().join("Mods/LoadingProgressDev/About/About.xml"),
            "<ModMetaData><packageId>ilyvion.loadingprogress</packageId><name>Loading Progress (dev)</name><supportedVersions><li>1.6</li></supportedVersions></ModMetaData>",
        );
        write(&tmp.path().join("Mods/LoadingProgressDev/About/PublishedFileId.txt"), "3535481557");
        let work = at(tmp.path(), "workspace/3799021999");
        write(&work.join("About/About.xml"), "<ModMetaData><packageId>example.linkedbyid</packageId><name>Linked</name><supportedVersions><li>1.6</li></supportedVersions></ModMetaData>");
        write(&work.join("About/PublishedFileId.txt"), "3799021999");
        link_dir(&work, &at(tmp.path(), "Mods/3799021999"));

        let opts = ScanOptions { locations: loc, game_version: GameVersion::parse("1.6.4530 rev1235").unwrap(), use_cache: false, workshop_updated: HashMap::new() };
        let out = scan(&opts, None, true, &|_, _| {}).unwrap();
        let by_id = |id: &str| out.mods.iter().find(|m| m.package_id == id).unwrap();
        let dev = by_id("ilyvion.loadingprogress");
        assert_eq!(dev.source, Source::Local);
        assert_eq!(dev.published_file_id, Some(3535481557), "it still knows where the mod is published");
        assert_eq!(by_id("example.linkedbyid").source, Source::Local, "a link is never a SteamCMD download");
        assert_eq!(by_id("brrainz.harmony").source, Source::SteamCmd);
    }

    /// Modmixer and Circinus Dev Tools keep a mod in a workspace and put a link named after a
    /// hash in the Mods folder. RimWorld loads the mod through the link; so must the scan.
    #[test]
    fn linked_mod_folders_are_found_and_read_through() {
        let tmp = tempfile::tempdir().unwrap();
        let loc = fixture_game(tmp.path());
        let work = at(tmp.path(), "workspace/Mods/6eb6cb0b799f");
        write(
            &work.join("About/About.xml"),
            "<ModMetaData><packageId>example.linked</packageId><name>Linked Mod</name><supportedVersions><li>1.6</li></supportedVersions></ModMetaData>",
        );
        write(&work.join("About/PublishedFileId.txt"), "3000000001\n");
        write(&work.join(".git/HEAD"), "ref: refs/heads/main");
        write(&work.join("Assemblies/LinkedMod.dll"), "x");
        write(&work.join("Defs/Things.xml"), "<Defs/>");
        // textures shared through a link inside the mod as well
        write(&tmp.path().join("shared/Textures/Things/Wall.png"), "png");
        link_dir(&tmp.path().join("shared/Textures"), &work.join("Textures"));
        let link = at(tmp.path(), "Mods/6eb6cb0b799f");
        link_dir(&work, &link);
        // a link to nowhere must not break the scan, only be reported
        link_dir(&tmp.path().join("gone"), &tmp.path().join("Mods/deadbeef0000"));

        let opts = ScanOptions { locations: loc, game_version: GameVersion::parse("1.6.4530 rev1235").unwrap(), use_cache: false, workshop_updated: HashMap::new() };
        let out = scan(&opts, None, true, &|_, _| {}).unwrap();
        let m = out.mods.iter().find(|m| m.package_id == "example.linked").expect("the linked mod is listed");
        assert_eq!(m.path, link, "known by the entry in the Mods folder, as RimWorld reports it");
        assert_eq!(m.uid, link.to_string_lossy());
        assert_eq!(m.link_target.as_deref(), Some(work.as_path()));
        assert_eq!(m.name, "Linked Mod");
        assert_eq!(m.source, Source::Git, "a git checkout, even with a PublishedFileId.txt in it");
        assert_eq!(m.published_file_id, Some(3000000001));
        assert_eq!(m.contents.assemblies, 1);
        assert_eq!(m.contents.defs, 1);
        assert_eq!(m.contents.textures, 1, "read through the link inside the mod");
        assert_eq!(m.kind, ModKind::Code);
        assert_eq!(out.files[&m.uid].textures, vec!["textures/things/wall.png".trim_end_matches(".png").to_string()]);
        assert!(m.modified > 0);
        assert_eq!(out.unreadable.len(), 1, "{:?}", out.unreadable);
        assert!(out.unreadable[0].path.ends_with("deadbeef0000"));
        assert!(out.unreadable[0].reason.contains("gone"), "{}", out.unreadable[0].reason);
        assert!(out.mods.iter().all(|m| !m.uid.ends_with("deadbeef0000")));
        // the quick scan sees the same mod, and the cache serves it afterwards
        let cache = Cache::open(&tmp.path().join("cache.sqlite")).unwrap();
        let opts = ScanOptions { use_cache: true, ..opts };
        let mut quick = scan(&opts, Some(&cache), false, &|_, _| {}).unwrap();
        let q = quick.mods.iter().find(|m| m.package_id == "example.linked").unwrap();
        assert_eq!(q.link_target.as_deref(), Some(work.as_path()));
        let shallow: Vec<ModInfo> = quick.mods.iter().filter(|m| quick.shallow.contains(&m.uid)).cloned().collect();
        let ins = inspect_mods(&shallow, &|_, _| {});
        apply_inspections(&mut quick.mods, &mut quick.files, &quick.stamps, ins, Some(&cache)).unwrap();
        assert_eq!(quick.mods, out.mods);
        let again = scan(&opts, Some(&cache), false, &|_, _| {}).unwrap();
        assert_eq!(again.from_cache, out.mods.len());
        assert_eq!(again.mods.iter().find(|m| m.package_id == "example.linked").unwrap().contents.textures, 1);
    }

    #[test]
    fn quick_then_inspect_matches_deep() {
        let tmp = tempfile::tempdir().unwrap();
        let loc = fixture_game(tmp.path());
        let cache = Cache::open(&tmp.path().join("cache.sqlite")).unwrap();
        let opts = ScanOptions { locations: loc, game_version: GameVersion::parse("1.6.4530 rev1235").unwrap(), use_cache: true, workshop_updated: HashMap::new() };
        let mut quick = scan(&opts, Some(&cache), false, &|_, _| {}).unwrap();
        assert_eq!(quick.shallow.len(), quick.mods.len());
        assert!(quick.mods.iter().all(|m| m.contents.assemblies == 0 && matches!(m.kind, ModKind::Unknown | ModKind::Official | ModKind::Scenario)));
        let shallow: Vec<ModInfo> = quick.mods.iter().filter(|m| quick.shallow.contains(&m.uid)).cloned().collect();
        let ins = inspect_mods(&shallow, &|_, _| {});
        let stored = apply_inspections(&mut quick.mods, &mut quick.files, &quick.stamps, ins, Some(&cache)).unwrap();
        assert_eq!(stored, quick.mods.len());
        let deep = scan(&opts, None, true, &|_, _| {}).unwrap();
        assert_eq!(quick.mods, deep.mods);
        assert_eq!(quick.files, deep.files);
        // and the cache now serves everything
        let again = scan(&opts, Some(&cache), false, &|_, _| {}).unwrap();
        assert_eq!(again.from_cache, deep.mods.len());
        assert!(again.shallow.is_empty());
    }

    #[test]
    fn steam_timeupdated_invalidates_workshop_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let mut loc = fixture_game(tmp.path());
        let ws = tmp.path().join("workshop/content/294100");
        write(&ws.join("2009463077/About/About.xml"), "<ModMetaData><packageId>ws.mod</packageId><name>WS</name></ModMetaData>");
        loc.workshop_dir = Some(ws);
        let cache = Cache::open(&tmp.path().join("cache.sqlite")).unwrap();
        let gv = GameVersion::parse("1.6.4530 rev1235").unwrap();
        let mut opts = ScanOptions { locations: loc, game_version: gv, use_cache: true, workshop_updated: HashMap::from([(2009463077u64, 4_000_000_000u64)]) };
        let first = scan(&opts, Some(&cache), true, &|_, _| {}).unwrap();
        let m = first.mods.iter().find(|m| m.package_id == "ws.mod").unwrap();
        assert_eq!(m.source, Source::Workshop);
        assert_eq!(m.published_file_id, Some(2009463077));
        assert_eq!(m.modified, 4_000_000_000, "Steam's timeupdated is newer than the folder");
        assert_eq!(m.updated, 4_000_000_000, "and it is kept on its own, so the two dates can be told apart");
        let second = scan(&opts, Some(&cache), true, &|_, _| {}).unwrap();
        assert_eq!(second.from_cache, second.mods.len());
        // Steam updated the item in place: nothing on disk changed except the ACF.
        opts.workshop_updated.insert(2009463077, 4_100_000_000);
        let third = scan(&opts, Some(&cache), true, &|_, _| {}).unwrap();
        assert_eq!(third.parsed, 1, "only the updated item is re-read");
        assert_eq!(third.mods.iter().find(|m| m.package_id == "ws.mod").unwrap().modified, 4_100_000_000);
    }

    #[test]
    fn cache_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let loc = fixture_game(tmp.path());
        let cache = Cache::open(&tmp.path().join("cache.sqlite")).unwrap();
        let opts = ScanOptions { locations: loc, game_version: GameVersion::parse("1.6.4530 rev1235").unwrap(), use_cache: true, workshop_updated: HashMap::new() };
        let first = scan(&opts, Some(&cache), true, &|_, _| {}).unwrap();
        assert_eq!(first.from_cache, 0);
        let second = scan(&opts, Some(&cache), true, &|_, _| {}).unwrap();
        assert_eq!(second.from_cache, first.mods.len());
        assert_eq!(first.mods, second.mods);
        assert_eq!(first.files, second.files);
    }
}

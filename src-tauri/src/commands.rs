//! The command surface the Svelte UI calls with `invoke`.

use crate::downloads::{AddResult, Downloads, SteamCmdStatus};
use crate::textures::{self, AuditReport, ModTextures, Report, TexState, Textures};
use crate::state::{App, LaunchMethod, Settings, Snapshot, UserData};
use circinus_core::steam::steamcmd::QueueState;
use circinus_core::steam::webapi;
use circinus_core::import::{self, ImportedList};
use circinus_core::model::*;
use circinus_core::paths::Locations;
use circinus_core::rules::{self, RulesFile};
use circinus_core::scan::ModFiles;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

pub type Shared = Arc<Mutex<App>>;

type CmdResult<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Run `f` with the locked app on a blocking thread.
async fn with_app<T: Send + 'static>(state: &State<'_, Shared>, f: impl FnOnce(&mut App) -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut app = shared.lock().map_err(|_| "state lock poisoned".to_string())?;
        f(&mut app)
    })
    .await
    .map_err(err)?
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    /// "read" (About folders) or "inspect" (walking contents).
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn get_snapshot(state: State<'_, Shared>) -> CmdResult<Snapshot> {
    let snap = with_app(&state, |app| Ok(app.snapshot())).await?;
    if cfg!(debug_assertions) {
        let bytes = serde_json::to_vec(&snap).map(|v| v.len()).unwrap_or(0);
        tracing::info!(bytes, "get_snapshot serialized");
    }
    Ok(snap)
}

#[tauri::command]
pub async fn get_description(state: State<'_, Shared>, uid: String) -> CmdResult<String> {
    with_app(&state, move |app| Ok(app.description(&uid))).await
}

/// Re-read the mod folders. Returns as soon as the quick phase is done; the contents
/// inspection continues in the background and ends with a `state-changed` event.
#[tauri::command]
pub async fn rescan(app_handle: AppHandle, state: State<'_, Shared>, full: bool) -> CmdResult<Snapshot> {
    let shared = state.inner().clone();
    let handle = app_handle.clone();
    let shallow = tauri::async_runtime::spawn_blocking(move || crate::scan_quick_phase(&handle, &shared, full)).await.map_err(err)??;
    let shared = state.inner().clone();
    let handle = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || crate::inspect_phase(&handle, &shared, shallow));
    with_app(&state, |app| Ok(app.snapshot())).await
}

#[tauri::command]
pub async fn set_active(state: State<'_, Shared>, uids: Vec<String>) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.set_active(uids);
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn activate(state: State<'_, Shared>, uids: Vec<String>, at: Option<usize>) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.activate(&uids, at);
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn deactivate(state: State<'_, Shared>, uids: Vec<String>) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.deactivate(&uids);
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn halo(state: State<'_, Shared>, apply: bool) -> CmdResult<SortResult> {
    with_app(&state, move |app| Ok(app.halo(apply))).await
}

#[tauri::command]
pub async fn validate(state: State<'_, Shared>) -> CmdResult<Vec<Issue>> {
    with_app(&state, |app| Ok(app.issues())).await
}

/// HALO's built-in classification rules, in the order they are tried, for the HALO page.
#[tauri::command]
pub fn halo_rules() -> Vec<circinus_core::order::BuiltinRule> {
    circinus_core::order::builtin_rules()
}


#[tauri::command]
pub async fn save_mods_config(state: State<'_, Shared>) -> CmdResult<String> {
    with_app(&state, |app| app.save().map(|p| p.display().to_string()).map_err(err)).await
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub list: ImportedList,
    pub uids: Vec<String>,
    pub missing: Vec<String>,
}

#[tauri::command]
pub async fn import_list(state: State<'_, Shared>, path: Option<String>, text: Option<String>) -> CmdResult<ImportPreview> {
    with_app(&state, move |app| {
        let list = match (path, text) {
            (Some(p), _) => import::import_file(&PathBuf::from(p)).map_err(err)?,
            (None, Some(t)) => import::import_text(&t, &PathBuf::from("pasted.txt")).map_err(err)?,
            _ => return Err("Nothing to import".into()),
        };
        let (uids, missing) = app.resolve_import(&list);
        Ok(ImportPreview { list, uids, missing })
    })
    .await
}

#[tauri::command]
pub async fn apply_import(state: State<'_, Shared>, uids: Vec<String>, append: bool) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        if append {
            app.activate(&uids, None);
        } else {
            app.set_active(uids);
        }
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn update_settings(state: State<'_, Shared>, settings: Settings) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        let locations_changed = app.settings.locations != settings.locations;
        let sources_changed = app.settings.db_sources != settings.db_sources;
        app.settings = settings;
        app.persist().map_err(err)?;
        if locations_changed {
            app.resolve_locations();
        }
        if sources_changed {
            // Switching one off deletes it and takes effect now. It used to take effect never:
            // the setting was written down and nothing read it.
            app.forget_disabled_databases();
        }
        if locations_changed || sources_changed {
            app.load_databases();
        }
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn autodetect_locations() -> CmdResult<Locations> {
    tauri::async_runtime::spawn_blocking(Locations::detect).await.map_err(err)
}

#[tauri::command]
pub async fn update_user(state: State<'_, Shared>, user: UserData) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.user = user;
        app.persist().map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn update_databases(state: State<'_, Shared>) -> CmdResult<Vec<String>> {
    let (sources, dir, version) = {
        let app = state.inner().lock().map_err(|_| "state lock poisoned".to_string())?;
        (app.settings.db_sources.clone(), app.data_dir.join("dbs"), app.game_version.major_minor.clone())
    };
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let mut report = Vec::new();
    for src in sources.iter().filter(|s| s.enabled) {
        match rules::fetch_source(&client, src, &dir, &version).await {
            Ok(true) => report.push(format!("{}: updated", src.label)),
            Ok(false) => report.push(format!("{}: already current", src.label)),
            Err(e) => report.push(format!("{}: failed ({e})", src.label)),
        }
    }
    with_app(&state, |app| {
        app.load_databases();
        Ok(())
    })
    .await?;
    Ok(report)
}

#[tauri::command]
pub async fn refresh_weights(state: State<'_, Shared>) -> CmdResult<usize> {
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let (fetched, sample) = circinus_core::weight::fetch_all(&client).await.map_err(err)?;
    with_app(&state, move |app| {
        app.store_weights_sample(sample);
        let n = app.store_weights(fetched).map_err(err)?;
        let local = if app.settings.include_local_runs { app.merge_local_weights() } else { 0 };
        Ok(n + local)
    })
    .await
}

#[tauri::command]
pub async fn refresh_local_weights(state: State<'_, Shared>) -> CmdResult<usize> {
    with_app(&state, |app| Ok(app.merge_local_weights())).await
}

#[tauri::command]
pub async fn get_files(state: State<'_, Shared>, uid: String) -> CmdResult<ModFiles> {
    with_app(&state, move |app| Ok(app.files.get(&uid).cloned().unwrap_or_default())).await
}

#[tauri::command]
pub async fn get_user_rules(state: State<'_, Shared>) -> CmdResult<RulesFile> {
    with_app(&state, |app| Ok(app.db.user.clone())).await
}

#[tauri::command]
pub async fn set_user_rules(state: State<'_, Shared>, rules: RulesFile) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.write_user_rules(&rules).map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleEdit {
    pub rule: Rule,
    pub remove: bool,
}

/// Add or remove one user rule (or an ignore entry when `rule.source` is not `user`).
#[tauri::command]
pub async fn edit_user_rule(state: State<'_, Shared>, edit: RuleEdit) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        let mut file = app.db.user.clone();
        let mut r = edit.rule;
        if r.source == RuleSource::User {
            file.rules.retain(|x| !(x.kind == r.kind && x.subject == r.subject && x.target == r.target));
            if !edit.remove {
                file.rules.push(r);
            }
        } else {
            r.source = RuleSource::User;
            file.ignore.retain(|x| !(x.kind == r.kind && x.subject == r.subject && x.target == r.target));
            if !edit.remove {
                file.ignore.push(r);
            }
        }
        app.write_user_rules(&file).map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub fn app_data_dir(state: State<'_, Shared>) -> CmdResult<String> {
    let app = state.inner().lock().map_err(|_| "state lock poisoned".to_string())?;
    Ok(app.data_dir.display().to_string())
}


// ---------------------------------------------------------------- list history

#[tauri::command]
pub async fn saved_lists(state: State<'_, Shared>) -> CmdResult<Vec<circinus_core::modsconfig::SavedList>> {
    with_app(&state, |app| Ok(app.saved_lists())).await
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub snapshot: Snapshot,
    pub restored: usize,
    pub missing: Vec<String>,
}

/// Put an archived list back as the active list; `save` writes it to ModsConfig.xml too.
#[tauri::command]
pub async fn restore_list(state: State<'_, Shared>, path: String, save: bool) -> CmdResult<RestoreResult> {
    with_app(&state, move |app| {
        let (restored, missing) = app.restore_list(std::path::Path::new(&path)).map_err(err)?;
        if save {
            app.save().map_err(err)?;
        }
        Ok(RestoreResult { snapshot: app.snapshot(), restored, missing })
    })
    .await
}

// ---------------------------------------------------------------- named lists

#[tauri::command]
pub async fn save_named_list(state: State<'_, Shared>, name: String) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.save_named_list(&name).map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn load_named_list(state: State<'_, Shared>, name: String) -> CmdResult<RestoreResult> {
    with_app(&state, move |app| {
        let (restored, missing) = app.load_named_list(&name).map_err(err)?;
        Ok(RestoreResult { snapshot: app.snapshot(), restored, missing })
    })
    .await
}

#[tauri::command]
pub async fn delete_named_list(state: State<'_, Shared>, name: String) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.delete_named_list(&name).map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn rename_named_list(state: State<'_, Shared>, from: String, to: String) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.rename_named_list(&from, &to).map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn detach_list(state: State<'_, Shared>) -> CmdResult<Snapshot> {
    with_app(&state, |app| {
        app.detach_list();
        Ok(app.snapshot())
    })
    .await
}

/// Keep your own copy of a Workshop mod, and load that instead of Steam's.
///
/// Steam owns the Workshop folder and rewrites it whenever the author publishes; a copy in the
/// game's own Mods folder is yours, and Steam never touches it. It lands at `Mods/<workshop id>`
/// with a `PublishedFileId.txt`, which is exactly the shape SteamCMD downloads have -- so it is
/// the same mod to everything downstream, Force update included, and Circinus can still tell you
/// when the author has published something newer without any of it arriving on its own.
#[tauri::command]
pub async fn localize_mod(app_handle: AppHandle, state: State<'_, Shared>, uid: String) -> CmdResult<(Snapshot, String)> {
    let want = uid.clone();
    let (src, dst, id, at) = with_app(&state, move |app| app.localize_plan(&want).map_err(err)).await?;
    let (name, folder) = (dst.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), dst.clone());
    // Off the lock: a big mod is thousands of files and the window must stay alive.
    let (files, bytes) = tauri::async_runtime::spawn_blocking(move || {
        let copied = circinus_core::fsx::copy_tree(&src, &dst).map_err(|e| format!("Could not copy the mod: {e}"))?;
        // A Workshop item is identified by the number on its folder; SteamCMD writes the id into
        // About as well. The copy carries both, so nothing downstream has to guess.
        let about = dst.join("About");
        std::fs::create_dir_all(&about).map_err(|e| format!("Could not write to the copy: {e}"))?;
        std::fs::write(about.join("PublishedFileId.txt"), format!("{id}\n")).map_err(|e| format!("Could not write the Workshop id into the copy: {e}"))?;
        Ok::<_, String>(copied)
    })
    .await
    .map_err(err)??;

    // The same two-phase rescan the Rescan button runs, so the copy is a mod like any other.
    let shared = state.inner().clone();
    let handle = app_handle.clone();
    let shallow = tauri::async_runtime::spawn_blocking(move || crate::scan_quick_phase(&handle, &shared, false)).await.map_err(err)??;
    let shared = state.inner().clone();
    let handle = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || crate::inspect_phase(&handle, &shared, shallow));

    with_app(&state, move |app| {
        let took = app.localized_took_its_place(id, at);
        let where_ = folder.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let mb = bytes as f64 / 1_048_576.0;
        let msg = match (took.is_some(), at.is_some()) {
            (true, true) => format!("Copied {files} files ({mb:.0} MB) to {name} in {where_}, and your list now loads that copy. Steam's copy stays subscribed and updated; it just is not the one the game reads."),
            (true, false) => format!("Copied {files} files ({mb:.0} MB) to {name} in {where_}. Activate it and the game will load your copy rather than Steam's."),
            _ => format!("Copied {files} files ({mb:.0} MB) to {name} in {where_}, but Circinus has not read the copy back yet. Rescan and it will be there."),
        };
        Ok((app.snapshot(), msg))
    })
    .await
}

/// Delete a mod's folder (recycle bin), or just the link when the entry is one.
#[tauri::command]
pub async fn delete_mod(state: State<'_, Shared>, uid: String) -> CmdResult<(Snapshot, String)> {
    with_app(&state, move |app| {
        let what = app.delete_mod(&uid).map_err(err)?;
        Ok((app.snapshot(), what))
    })
    .await
}

// ---------------------------------------------------------------- collections

/// Follow a Steam collection: `text` is its link or id.
#[tauri::command]
pub async fn collection_track(state: State<'_, Shared>, text: String) -> CmdResult<Snapshot> {
    let ids = webapi::extract_workshop_ids(&text);
    let id = *ids.first().ok_or_else(|| "No Workshop link or id found".to_string())?;
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let details = webapi::published_file_details(&client, &[id]).await.map_err(err)?;
    let item = details.into_iter().find(|i| i.published_file_id == id).ok_or_else(|| "Steam has no such item".to_string())?;
    if item.file_type != 2 {
        return Err(format!("{} is a mod, not a collection. Add mods from the Import dialog or the Downloads view", item.title));
    }
    let fetched = fetch_collection(&client, id).await?;
    with_app(&state, move |app| {
        if app.user.collections.iter().any(|c| c.id == id) {
            return Err(format!("You already follow {}", item.title));
        }
        let now = crate::state::now_secs();
        app.user.collections.push(crate::state::TrackedCollection { id, name: item.title.clone(), creator: item.creator.clone(), items: fetched.0.clone(), known: fetched.0, names: fetched.1, checked_at: now, added_at: now, time_updated: item.time_updated });
        app.persist().map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

/// Items and titles of a collection, one level of sub-collections included.
pub(crate) async fn fetch_collection(client: &reqwest::Client, id: u64) -> CmdResult<(Vec<u64>, HashMap<u64, String>)> {
    let items = webapi::collection_items(client, id).await.map_err(err)?;
    let mut names = HashMap::new();
    if let Ok(details) = webapi::published_file_details(client, &items).await {
        for d in details {
            names.insert(d.published_file_id, d.title);
        }
    }
    Ok((items, names))
}

/// Fetch a followed collection again (all of them when `id` is None) and note what changed.
#[tauri::command]
pub async fn collection_refresh(state: State<'_, Shared>, id: Option<u64>) -> CmdResult<Snapshot> {
    let ids: Vec<u64> = with_app(&state, move |app| Ok(app.user.collections.iter().map(|c| c.id).filter(|c| id.map(|i| i == *c).unwrap_or(true)).collect())).await?;
    if ids.is_empty() {
        return with_app(&state, |app| Ok(app.snapshot())).await;
    }
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let details = webapi::published_file_details(&client, &ids).await.unwrap_or_default();
    let mut fetched: Vec<(u64, Vec<u64>, HashMap<u64, String>)> = Vec::new();
    let mut failed = Vec::new();
    for id in &ids {
        match fetch_collection(&client, *id).await {
            Ok((items, names)) => fetched.push((*id, items, names)),
            Err(e) => failed.push(format!("{id}: {e}")),
        }
    }
    with_app(&state, move |app| {
        let now = crate::state::now_secs();
        for (id, items, names) in fetched {
            if let Some(c) = app.user.collections.iter_mut().find(|c| c.id == id) {
                c.items = items;
                c.names.extend(names);
                c.checked_at = now;
                if let Some(d) = details.iter().find(|d| d.published_file_id == id) {
                    c.name = d.title.clone();
                    c.creator = d.creator.clone();
                    c.time_updated = d.time_updated;
                }
            }
        }
        app.persist().map_err(err)?;
        if !failed.is_empty() {
            return Err(format!("Steam did not answer for {}", failed.join(", ")));
        }
        Ok(app.snapshot())
    })
    .await
}

/// The user has seen the collection's changes: measure from its current contents.
#[tauri::command]
pub async fn collection_acknowledge(state: State<'_, Shared>, id: u64) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        if let Some(c) = app.user.collections.iter_mut().find(|c| c.id == id) {
            c.known = c.items.clone();
        }
        app.persist().map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn collection_untrack(state: State<'_, Shared>, id: u64) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.user.collections.retain(|c| c.id != id);
        app.persist().map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

// ---------------------------------------------------------------- opening a folder

/// The folder to hand the file manager, or why it cannot be handed one.
///
/// Separate from the command so it can be tested: a command needs an `AppHandle` and this is the
/// part with the decisions in it.
///
/// `is_dir` follows links, which is what a player means -- a mod deployed as a link to a
/// workspace is a folder as far as anyone opening it is concerned. It also refuses anything that
/// is *not* a folder, which matters more than it looks: `open_path` hands a path to the system's
/// default handler, and the default handler for an executable is to run it. Nothing here should
/// ever be able to start a program, and a mod folder can contain links a mod author chose.
fn folder_to_open(path: &str) -> std::result::Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Err(format!("{path} is not there any more. It may have been moved, renamed or removed since Circinus last read the folders."));
    }
    if !p.is_dir() {
        return Err(format!("{path} is a file, not a folder. Circinus only opens folders."));
    }
    Ok(p)
}

/// Open a folder in the file manager -- that folder, not the one above it.
///
/// This is a command of our own rather than the opener plugin's `open_path` called from the
/// window, because that one is scope-checked against the capability file and a permission listed
/// without an `allow` list has an *empty* scope: it refuses every path, on every machine,
/// always. Listing `opener:allow-open-path` and expecting it to work is the mistake this exists
/// to stop being possible. Widening that scope to `**` would work and would also let the window
/// ask the system to open any path at all, including an executable; going through Rust means the
/// check is `is_dir` and the answer is a real reason rather than a guess.
#[tauri::command]
pub async fn open_folder(app_handle: AppHandle, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = folder_to_open(&path)?;
    app_handle
        .opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Could not open {path}: {e}"))
}

// ---------------------------------------------------------------- what a curator said

/// Fetch every followed pack's announcements.
///
/// One call per pack, and every failure is silence: `announce::fetch_pack` turns a 404, a dead
/// endpoint and a broken connection all into an empty list, so this cannot put an error in front
/// of somebody who only wanted to launch a game. The endpoint is not served yet at the time of
/// writing, and that is exactly the case this has to survive.
///
/// Muted packs are not asked about at all. Muting is meant to mean "leave me alone", and a
/// request that only gets thrown away afterwards does not honour that.
#[tauri::command]
pub async fn announcements_refresh(state: State<'_, Shared>) -> CmdResult<Snapshot> {
    let packs: Vec<(u64, i64)> = with_app(&state, |app| {
        Ok(app
            .user
            .collections
            .iter()
            .filter(|c| !app.user.packs_muted.contains(&c.id))
            // Everything the site will give, rather than only what is new: the panel shows a
            // curator's recent posts, not a queue that empties itself as you read it.
            .map(|c| (c.id, 0i64))
            .collect())
    })
    .await?;
    if packs.is_empty() {
        return with_app(&state, |app| {
            app.announcements.clear();
            Ok(app.snapshot())
        })
        .await;
    }
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let got = circinus_core::announce::fetch_all(&client, &packs).await;
    with_app(&state, move |app| {
        app.announcements = got;
        app.announcements_checked_at = crate::state::now_secs();
        Ok(app.snapshot())
    })
    .await
}

/// The user has read this pack's announcements up to `at` (unix seconds).
#[tauri::command]
pub async fn announcements_seen(state: State<'_, Shared>, pack: u64, at: i64) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        // Never backwards: reading an old post after a new one must not make the new one unread
        // again, and two windows racing must not lose the further of the two.
        let e = app.user.packs_read.entry(pack).or_insert(0);
        *e = (*e).max(at);
        app.persist().map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

/// Stop, or resume, hearing from one pack's curator. Following the pack is untouched.
#[tauri::command]
pub async fn announcements_mute(state: State<'_, Shared>, pack: u64, muted: bool) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        if muted {
            app.user.packs_muted.insert(pack);
        } else {
            app.user.packs_muted.remove(&pack);
        }
        app.persist().map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

// ---------------------------------------------------------------- instances

use crate::instances::{self, Instance};

#[tauri::command]
pub async fn instances_list(state: State<'_, Shared>) -> CmdResult<Vec<Instance>> {
    with_app(&state, |app| Ok(instances::list(app))).await
}

#[tauri::command]
pub async fn instance_current(state: State<'_, Shared>) -> CmdResult<Instance> {
    with_app(&state, |app| Ok(app.instance.clone())).await
}

/// Make an instance: from the folders that are open now, or empty.
#[tauri::command]
pub async fn instance_create(state: State<'_, Shared>, name: String, from_current: bool) -> CmdResult<Instance> {
    with_app(&state, move |app| instances::create(app, &name, from_current).map_err(err)).await
}

#[tauri::command]
pub async fn instance_duplicate(state: State<'_, Shared>, id: String, name: Option<String>) -> CmdResult<Instance> {
    with_app(&state, move |app| instances::duplicate(app, &id, name.as_deref()).map_err(err)).await
}

#[tauri::command]
pub async fn instance_rename(state: State<'_, Shared>, id: String, name: String) -> CmdResult<Instance> {
    with_app(&state, move |app| instances::rename(app, &id, &name).map_err(err)).await
}

/// Change one instance's four folders and launch settings.
#[tauri::command]
pub async fn instance_update(state: State<'_, Shared>, id: String, locations: Locations, launch: crate::state::LaunchSettings) -> CmdResult<Instance> {
    with_app(&state, move |app| instances::update(app, &id, locations, launch).map_err(err)).await
}

/// Forget an instance. Nothing of the game's is deleted; the message says so.
#[tauri::command]
pub async fn instance_delete(app_handle: AppHandle, state: State<'_, Shared>, id: String) -> CmdResult<String> {
    let (what, was_current) = with_app(&state, move |app| {
        let was_current = app.instance.id == id;
        Ok((instances::delete(app, &id).map_err(err)?, was_current))
    })
    .await?;
    // Deleting the instance that was open moves to another one: its mods have to be read.
    if was_current {
        let shared = state.inner().clone();
        let handle = app_handle.clone();
        tauri::async_runtime::spawn_blocking(move || crate::run_scan(handle, shared, false));
    }
    Ok(what)
}

/// Open another instance: its folders, its launch settings, its named lists, its list.
/// `discard` is the user saying that unsaved changes to the current list may be lost.
#[tauri::command]
pub async fn instance_switch(app_handle: AppHandle, state: State<'_, Shared>, id: String, discard: bool) -> CmdResult<Instance> {
    let inst = with_app(&state, move |app| instances::switch(app, &id, discard).map_err(err)).await?;
    let shared = state.inner().clone();
    let handle = app_handle.clone();
    // The scan reads the new folders and ModsConfig.xml, then publishes `state-changed`.
    tauri::async_runtime::spawn_blocking(move || crate::run_scan(handle, shared, false));
    Ok(inst)
}

// ---------------------------------------------------------------- game log

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub path: String,
    pub exists: bool,
    pub bytes: u64,
    /// Unix seconds.
    pub modified: i64,
}

fn log_file(p: &std::path::Path) -> LogFile {
    let md = std::fs::metadata(p).ok();
    LogFile {
        path: p.display().to_string(),
        exists: md.is_some(),
        bytes: md.as_ref().map(|m| m.len()).unwrap_or(0),
        modified: md.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0),
    }
}

/// Where RimWorld writes Player.log and Player-prev.log on this machine.
#[tauri::command]
pub async fn player_log_paths(state: State<'_, Shared>) -> CmdResult<Vec<LogFile>> {
    with_app(&state, |app| Ok(crate::logs::default_paths(app).iter().map(|p| log_file(p)).collect())).await
}

/// Parse a Player.log (the current one when `path` is None) and tie it to the installed mods.
#[tauri::command]
pub async fn analyze_player_log(state: State<'_, Shared>, path: Option<String>) -> CmdResult<crate::logs::LogAnalysis> {
    with_app(&state, move |app| {
        let path = match path {
            Some(p) => PathBuf::from(p),
            None => crate::logs::default_paths(app).into_iter().find(|p| p.is_file()).ok_or_else(|| "No Player.log found. RimWorld writes it next to its Config folder once it has run.".to_string())?,
        };
        crate::logs::analyze(app, &path)
    })
    .await
}

// ---------------------------------------------------------------- launching

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchInfo {
    /// Executable Circinus would start (detected or configured).
    pub executable: Option<String>,
    pub executable_exists: bool,
    pub steam_install: bool,
    /// What Auto resolves to right now: "steam" or "executable".
    pub auto_resolves_to: &'static str,
    /// The whole command line, `-savedatafolder` included, so the user can see what Play does.
    pub args: Vec<String>,
    /// The folder the game will keep its config and saves in, when it is not the usual one.
    pub save_data_folder: Option<String>,
}

fn launch_info(app: &App) -> LaunchInfo {
    let game = app.locations.game_dir.clone();
    let steam_install = game.as_deref().map(circinus_core::paths::is_steam_install).unwrap_or(false);
    let exe = app.settings.launch.executable.clone().or_else(|| game.as_deref().and_then(circinus_core::paths::detect_executable));
    let exists = exe.as_ref().map(|p| p.exists()).unwrap_or(false);
    LaunchInfo {
        executable: exe.map(|p| p.display().to_string()),
        executable_exists: exists,
        steam_install,
        auto_resolves_to: if steam_install || !exists { "steam" } else { "executable" },
        args: instances::launch_args(&app.locations, &app.settings.launch.args),
        save_data_folder: instances::save_data_folder(&app.locations).map(|p| p.display().to_string()),
    }
}

#[tauri::command]
pub async fn get_launch_info(state: State<'_, Shared>) -> CmdResult<LaunchInfo> {
    with_app(&state, |app| Ok(launch_info(app))).await
}

/// Start RimWorld the way the settings say, saving ModsConfig.xml first if asked to.
#[tauri::command]
pub async fn launch_game(app_handle: AppHandle, state: State<'_, Shared>) -> CmdResult<String> {
    use tauri_plugin_opener::OpenerExt;
    let (method, exe, args, game_dir, saved) = with_app(&state, |app| {
        let mut saved = false;
        if app.dirty && app.settings.launch.save_first {
            app.save().map_err(err)?;
            saved = true;
        }
        let info = launch_info(app);
        let method = match app.settings.launch.method {
            LaunchMethod::Auto => {
                if info.auto_resolves_to == "steam" {
                    LaunchMethod::Steam
                } else {
                    LaunchMethod::Executable
                }
            }
            m => m,
        };
        // The arguments carry the instance's config folder when it is not the game's own one:
        // without that the game would read and rewrite the default ModsConfig.xml instead.
        Ok((method, info.executable.map(PathBuf::from), info.args, app.locations.game_dir.clone(), saved))
    })
    .await?;
    let suffix = if saved { " (ModsConfig.xml saved first)" } else { "" };
    match method {
        LaunchMethod::Steam | LaunchMethod::Auto => {
            let url = if args.is_empty() { "steam://rungameid/294100".to_string() } else { format!("steam://run/294100//{}/", args.join(" ")) };
            app_handle.opener().open_url(&url, None::<&str>).map_err(|e| format!("Could not hand the game to Steam ({e}). Is Steam installed? Otherwise set the executable in Settings, under Launching RimWorld."))?;
            Ok(format!("Asked Steam to start RimWorld{suffix}"))
        }
        LaunchMethod::Executable => {
            let exe = exe.filter(|p| p.exists()).ok_or_else(|| "No RimWorld executable found. Choose it in Settings, under Launching RimWorld".to_string())?;
            let name = exe.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            spawn_game(&exe, &args, game_dir.as_deref()).map_err(|e| format!("Could not start {name}: {e}"))?;
            Ok(format!("Started {name}{suffix}"))
        }
    }
}

fn spawn_game(exe: &std::path::Path, args: &[String], cwd: Option<&std::path::Path>) -> std::io::Result<()> {
    use std::process::{Command, Stdio};
    let mut cmd = if cfg!(target_os = "macos") && exe.extension().map(|e| e == "app").unwrap_or(false) {
        let mut c = Command::new("open");
        c.arg(exe);
        if !args.is_empty() {
            c.arg("--args").args(args);
        }
        c
    } else {
        let mut c = Command::new(exe);
        c.args(args);
        c
    };
    if let Some(dir) = cwd.or_else(|| exe.parent()) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0000_0008 | 0x0000_0200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    }
    cmd.spawn().map(|_| ())
}

// ---------------------------------------------------------------- downloads

type Dl<'a> = State<'a, Arc<Downloads>>;

#[tauri::command]
pub fn downloads_state(dl: Dl<'_>) -> QueueState {
    dl.snapshot()
}

#[tauri::command]
pub async fn downloads_add(dl: Dl<'_>, ids: Vec<u64>) -> CmdResult<AddResult> {
    Ok(dl.add(ids).await)
}

/// Force update: download mods again with SteamCMD into the folder each is installed in, Steam's
/// own folder for a Steam mod and Mods for a copy Circinus made. Anything else is refused with a
/// reason.
#[tauri::command]
pub async fn downloads_update(dl: Dl<'_>, state: State<'_, Shared>, uids: Vec<String>) -> CmdResult<AddResult> {
    let (targets, refused) = with_app(&state, move |app| Ok(app.update_targets(&uids))).await?;
    let mut result = if targets.is_empty() { AddResult { added: 0, skipped: Vec::new() } } else { dl.add_to(targets).await };
    result.skipped.extend(refused);
    Ok(result)
}

/// Workshop URLs, ids or pasted text; single collection links are expanded.
#[tauri::command]
pub async fn downloads_add_text(dl: Dl<'_>, text: String) -> CmdResult<AddResult> {
    let mut ids = webapi::extract_workshop_ids(&text);
    if ids.is_empty() {
        return Err("No workshop ids or links found in that text".into());
    }
    if ids.len() <= 5 {
        let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
        let mut expanded = Vec::new();
        for id in &ids {
            match webapi::collection_items(&client, *id).await {
                Ok(children) => expanded.extend(children),
                Err(_) => expanded.push(*id),
            }
        }
        ids = expanded;
    }
    Ok(dl.add(ids).await)
}

#[tauri::command]
pub fn downloads_remove(dl: Dl<'_>, ids: Vec<u64>) -> QueueState {
    dl.remove(&ids);
    dl.snapshot()
}

#[tauri::command]
pub fn downloads_retry_failed(dl: Dl<'_>) -> usize {
    dl.retry_failed()
}

#[tauri::command]
pub fn downloads_clear_finished(dl: Dl<'_>) -> QueueState {
    dl.clear_finished();
    dl.snapshot()
}

#[tauri::command]
pub fn downloads_pause(dl: Dl<'_>, paused: bool) -> QueueState {
    dl.set_paused(paused);
    dl.snapshot()
}

#[tauri::command]
pub async fn steamcmd_install(dl: Dl<'_>) -> CmdResult<()> {
    let d = dl.inner().clone();
    d.install_steamcmd().await
}

#[tauri::command]
pub fn steamcmd_status(dl: Dl<'_>) -> SteamCmdStatus {
    dl.status()
}

/// `+login anonymous +quit`, output streamed into the download log.
#[tauri::command]
pub async fn steamcmd_test(dl: Dl<'_>) -> CmdResult<circinus_core::steam::steamcmd::TestOutcome> {
    let d = dl.inner().clone();
    d.test_steamcmd().await
}

/// The user has read the "what changed" list: measure future changes from now.
#[tauri::command]
pub async fn acknowledge_changes(state: State<'_, Shared>) -> CmdResult<Snapshot> {
    with_app(&state, |app| {
        app.acknowledge_changes();
        Ok(app.snapshot())
    })
    .await
}

/// What a player pastes into Discord when something goes wrong: which build, which platform,
/// which folders and whether they are there, what was found, and the tail of the log.
#[tauri::command]
pub async fn diagnostics(state: State<'_, Shared>) -> CmdResult<String> {
    with_app(&state, |app| Ok(crate::diag::report(app))).await
}

/// Something in the window threw. Put it in the same log as everything else, so a report carries
/// it: a message that only ever reached a console nobody opens is a message nobody has.
#[tauri::command]
pub async fn log_from_the_window(message: String, stack: Option<String>) -> CmdResult<()> {
    // Bounded, because this is called from a place that can fail in a loop.
    let brief: String = message.chars().take(2000).collect();
    match stack {
        Some(s) => tracing::error!(target: "circinus", "window: {brief}\n{}", s.chars().take(4000).collect::<String>()),
        None => tracing::error!(target: "circinus", "window: {brief}"),
    }
    Ok(())
}

/// Hide, or bring back, the "these two do not work together" warning for one pair of mods.
#[tauri::command]
pub async fn set_incompatibility_hidden(state: State<'_, Shared>, uid: String, other_uid: String, hidden: bool) -> CmdResult<Snapshot> {
    with_app(&state, move |app| {
        app.set_incompatibility_hidden(&uid, &other_uid, hidden).map_err(err)?;
        Ok(app.snapshot())
    })
    .await
}

/// Show every hidden warning again. Returns how many came back.
#[tauri::command]
pub async fn clear_hidden_warnings(state: State<'_, Shared>) -> CmdResult<(usize, Snapshot)> {
    with_app(&state, |app| {
        let n = app.clear_hidden_warnings().map_err(err)?;
        Ok((n, app.snapshot()))
    })
    .await
}

/// The user has seen which mods are new: stop marking them. Separate from acknowledging changes
/// because they answer different questions -- what happened while you were away, against which
/// mods you have not looked at yet -- and clearing one should not quietly clear the other.
#[tauri::command]
pub async fn mark_new_seen(state: State<'_, Shared>) -> CmdResult<Snapshot> {
    with_app(&state, |app| {
        app.mark_new_seen();
        Ok(app.snapshot())
    })
    .await
}

/// Queue everything listed in ModsConfig.xml that is not installed (resolved via the Steam DB).
#[tauri::command]
pub async fn downloads_add_missing(dl: Dl<'_>, state: State<'_, Shared>) -> CmdResult<(AddResult, Vec<String>)> {
    let (ids, unresolved) = with_app(&state, |app| Ok(app.workshop_ids_for_missing())).await?;
    if ids.is_empty() {
        return Ok((AddResult { added: 0, skipped: vec![] }, unresolved));
    }
    Ok((dl.add(ids).await, unresolved))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPreview {
    pub ids: Vec<u64>,
    /// (workshop id, uid) for items already installed.
    pub installed: Vec<(u64, String)>,
    pub missing: Vec<u64>,
    pub names: HashMap<u64, String>,
}

use std::collections::HashMap;

/// Expand a Steam collection (or a pasted list of workshop links) and match it against the install.
#[tauri::command]
pub async fn import_collection(state: State<'_, Shared>, text: String) -> CmdResult<CollectionPreview> {
    let ids = webapi::extract_workshop_ids(&text);
    if ids.is_empty() {
        return Err("No workshop link or id found".into());
    }
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let mut all: Vec<u64> = Vec::new();
    for id in ids.iter().take(10) {
        match webapi::collection_items(&client, *id).await {
            Ok(children) => all.extend(children),
            Err(_) => all.push(*id),
        }
    }
    let mut names: HashMap<u64, String> = HashMap::new();
    if let Ok(items) = webapi::published_file_details(&client, &all).await {
        for i in items {
            names.insert(i.published_file_id, i.title);
        }
    }
    let all2 = all.clone();
    let (installed, missing) = with_app(&state, move |app| {
        let by_pfid: HashMap<u64, String> = app.mods.iter().filter(|m| m.invalid.is_none()).filter_map(|m| m.published_file_id.map(|id| (id, m.uid.clone()))).collect();
        let mut installed = Vec::new();
        let mut missing = Vec::new();
        for id in &all2 {
            match by_pfid.get(id) {
                Some(uid) => installed.push((*id, uid.clone())),
                None => missing.push(*id),
            }
        }
        Ok((installed, missing))
    })
    .await?;
    Ok(CollectionPreview { ids: all, installed, missing, names })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RentryPreview {
    pub preview: ImportPreview,
    /// Workshop ids mentioned in the paste that are not installed.
    pub missing_workshop_ids: Vec<u64>,
}

#[tauri::command]
pub async fn import_rentry(state: State<'_, Shared>, url: String) -> CmdResult<RentryPreview> {
    let id = circinus_core::rentry::parse_rentry_id(&url).ok_or_else(|| "That does not look like a Rentry link".to_string())?;
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let text = circinus_core::rentry::fetch_rentry(&client, &id, None).await.map_err(err)?;
    let (list, workshop_ids) = circinus_core::rentry::parse_rentry_text(&text);
    with_app(&state, move |app| {
        let (uids, missing) = app.resolve_import(&list);
        let installed: std::collections::HashSet<u64> = app.mods.iter().filter_map(|m| m.published_file_id).collect();
        let missing_workshop_ids = workshop_ids.into_iter().filter(|id| !installed.contains(id)).collect();
        Ok(RentryPreview { preview: ImportPreview { list, uids, missing }, missing_workshop_ids })
    })
    .await
}

// ---------------------------------------------------------------- textures

type Tex<'a> = State<'a, Arc<Textures>>;

#[tauri::command]
pub fn dds_state(tex: Tex<'_>) -> TexState {
    tex.snapshot()
}

#[tauri::command]
pub async fn dds_overview(state: State<'_, Shared>) -> CmdResult<Vec<ModTextures>> {
    with_app(&state, |app| Ok(textures::overview(app))).await
}

/// Convert the textures of these mods in the background; progress arrives as `dds-progress`.
#[tauri::command]
pub async fn dds_start(tex: Tex<'_>, uids: Vec<String>) -> CmdResult<()> {
    if tex.snapshot().running {
        return Err("A texture job is already running".into());
    }
    let t = tex.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = t.convert(uids) {
            tracing::warn!("dds convert: {e}");
        }
    });
    Ok(())
}

#[tauri::command]
pub fn dds_cancel(tex: Tex<'_>) {
    tex.cancel();
}

/// Remove the DDS files Circinus made for these mods, in the background; progress and the
/// final report arrive as `dds-progress`, like a conversion.
#[tauri::command]
pub async fn dds_revert(tex: Tex<'_>, uids: Vec<String>) -> CmdResult<()> {
    if tex.snapshot().running {
        return Err("A texture job is already running".into());
    }
    let t = tex.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = t.revert(uids) {
            tracing::warn!("dds revert: {e}");
        }
    });
    Ok(())
}

/// Find DDS files (not Circinus's) the game will refuse, in `uids`.
#[tauri::command]
pub async fn dds_audit(tex: Tex<'_>, uids: Vec<String>) -> CmdResult<AuditReport> {
    let t = tex.inner().clone();
    tauri::async_runtime::spawn_blocking(move || t.audit(uids)).await.map_err(err)?
}

/// Rebuild flagged files: `targets` pairs a mod with the files to fix (empty = all flagged).
#[tauri::command]
pub async fn dds_fix(tex: Tex<'_>, targets: Vec<(String, Vec<String>)>) -> CmdResult<Report> {
    let t = tex.inner().clone();
    tauri::async_runtime::spawn_blocking(move || t.fix(targets)).await.map_err(err)?
}

/// Ask the Workshop for the current update time of every installed workshop mod.
#[tauri::command]
pub async fn check_updates(state: State<'_, Shared>) -> CmdResult<usize> {
    let ids: Vec<u64> = with_app(&state, |app| Ok(app.workshop_ids().into_iter().map(|(_, id)| id).collect())).await?;
    if ids.is_empty() {
        return Ok(0);
    }
    let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
    let items = webapi::published_file_details(&client, &ids).await.map_err(err)?;
    with_app(&state, move |app| Ok(app.apply_update_check(&items))).await
}

#[cfg(test)]
mod open_folder_tests {
    use super::folder_to_open;

    #[test]
    fn a_folder_opens() {
        let dir = tempfile::tempdir().unwrap();
        assert!(folder_to_open(&dir.path().display().to_string()).is_ok());
    }

    #[test]
    fn a_file_does_not() {
        // `open_path` hands a path to the system's default handler, and the default handler for an
        // executable is to run it. A mod folder can contain links its author chose, so "is this a
        // folder" is a safety check and not a tidiness one.
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("mod.dll");
        std::fs::write(&f, b"MZ").unwrap();
        let err = folder_to_open(&f.display().to_string()).unwrap_err();
        assert!(err.contains("not a folder"), "{err}");
    }

    #[test]
    fn a_folder_that_is_gone_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("unsubscribed");
        let err = folder_to_open(&gone.display().to_string()).unwrap_err();
        assert!(err.contains("not there any more"), "{err}");
        // And names the path, because "a folder" is not something anyone can go and look at.
        assert!(err.contains("unsubscribed"), "{err}");
    }
}

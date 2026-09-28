//! The download manager: one background task that feeds SteamCMD batches from the queue,
//! honours the throttle, moves finished mods into the Mods folder (or, for a Force update of a
//! Steam mod, into Steam's own folder) and publishes progress.

use crate::commands::Shared;
use circinus_core::steam::steamcmd::{placement, ItemStatus, Placement, QueueState, SteamCmd, BATCH_PAUSE, STALL_TIMEOUT};
use circinus_core::steam::webapi;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

const QUEUE_KEY: &str = "download_queue";

pub struct Downloads {
    pub state: Mutex<QueueState>,
    notify: Notify,
    handle: AppHandle,
    app: Shared,
    client: reqwest::Client,
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AddResult {
    pub added: usize,
    pub skipped: Vec<(u64, String)>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamCmdStatus {
    pub installed: bool,
    pub installing: bool,
    pub root: String,
    pub exe: String,
    pub downloads_dir: String,
    pub console_log: String,
    pub console_log_bytes: u64,
    pub mods_dir: Option<String>,
    pub workshop_dir: Option<String>,
    pub queued: usize,
    pub running: bool,
    pub paused: bool,
    pub batch_size: usize,
    pub cooldown_until: Option<i64>,
}

impl Downloads {
    pub fn start(handle: AppHandle, app: Shared) -> Arc<Downloads> {
        let mut state: QueueState = app.lock().ok().and_then(|a| a.cache.get::<QueueState>(QUEUE_KEY).ok().flatten()).unwrap_or_default();
        for item in state.items.iter_mut().filter(|i| i.status == ItemStatus::Downloading) {
            item.status = ItemStatus::Queued;
        }
        state.running = false;
        state.installing = false;
        state.current_batch.clear();
        state.current_item = None;
        let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().unwrap_or_default();
        let dl = Arc::new(Downloads { state: Mutex::new(state), notify: Notify::new(), handle, app, client });
        dl.refresh_installed();
        let runner = dl.clone();
        tauri::async_runtime::spawn(async move { runner.run().await });
        dl
    }

    pub fn steamcmd(&self) -> SteamCmd {
        let root = self.app.lock().map(|a| a.data_dir.join("steamcmd")).unwrap_or_else(|_| std::path::PathBuf::from("steamcmd"));
        SteamCmd::new(root)
    }

    fn refresh_installed(&self) {
        let installed = self.steamcmd().is_installed();
        if let Ok(mut s) = self.state.lock() {
            s.steamcmd_installed = installed;
        }
    }

    pub fn snapshot(&self) -> QueueState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn persist(&self) {
        let snap = self.snapshot();
        if let Ok(app) = self.app.lock() {
            let _ = app.cache.set(QUEUE_KEY, &snap);
        }
    }

    pub fn emit(&self) {
        let _ = self.handle.emit("download-progress", self.snapshot());
    }

    fn wake(&self) {
        self.notify.notify_one();
    }

    /// Names for ids we know from the Steam database, so the queue is readable before the
    /// Web API answers.
    fn known_names(&self, ids: &[u64]) -> HashMap<u64, String> {
        let mut names = HashMap::new();
        if let Ok(app) = self.app.lock() {
            for id in ids {
                if let Some(e) = app.db.steam.by_pfid.get(id) {
                    let n = e.steam_name.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| e.name.clone());
                    if !n.is_empty() {
                        names.insert(*id, n);
                    }
                }
            }
        }
        names
    }

    /// Queue ids. Looks the ids up on Steam to name them and to skip things that are not
    /// RimWorld mods; if Steam does not answer, they are queued by number.
    pub async fn add(&self, ids: Vec<u64>) -> AddResult {
        self.add_to(ids.into_iter().map(|id| (id, None)).collect()).await
    }

    /// `add`, with where each download goes: `Some` is Steam's folder of a subscribed mod, which
    /// the download replaces (Force update of a Steam mod), `None` is `Mods/<id>`.
    pub async fn add_to(&self, targets: Vec<(u64, Option<String>)>) -> AddResult {
        let ids: Vec<u64> = targets.iter().map(|(id, _)| *id).collect();
        let into_steam: HashMap<u64, String> = targets.into_iter().filter_map(|(id, dest)| dest.map(|d| (id, d))).collect();
        let mut names = self.known_names(&ids);
        let mut skipped = Vec::new();
        let mut accepted: Vec<u64> = Vec::new();
        match webapi::published_file_details(&self.client, &ids).await {
            Ok(items) => {
                let by_id: HashMap<u64, _> = items.into_iter().map(|i| (i.published_file_id, i)).collect();
                for id in &ids {
                    match by_id.get(id) {
                        Some(item) if item.is_rimworld_mod() => {
                            names.insert(*id, item.title.clone());
                            accepted.push(*id);
                        }
                        Some(item) if item.file_type == 2 => skipped.push((*id, "that is a collection. Import it from the Import dialog".into())),
                        Some(item) if item.result != 1 => skipped.push((*id, "Steam says this item is hidden or removed".into())),
                        Some(_) => skipped.push((*id, "not a RimWorld workshop item".into())),
                        None => accepted.push(*id),
                    }
                }
            }
            Err(_) => accepted = ids.clone(),
        }
        let added = {
            let mut s = self.state.lock().unwrap();
            s.add_to(&accepted, &into_steam, &names, now())
        };
        self.persist();
        self.emit();
        self.wake();
        AddResult { added, skipped }
    }

    pub fn remove(&self, ids: &[u64]) {
        self.state.lock().unwrap().remove(ids);
        self.persist();
        self.emit();
    }

    pub fn retry_failed(&self) -> usize {
        let n = self.state.lock().unwrap().retry_failed();
        self.persist();
        self.emit();
        self.wake();
        n
    }

    pub fn clear_finished(&self) {
        self.state.lock().unwrap().clear_finished();
        self.persist();
        self.emit();
    }

    pub fn set_paused(&self, paused: bool) {
        self.state.lock().unwrap().paused = paused;
        self.persist();
        self.emit();
        self.wake();
    }

    pub async fn install_steamcmd(self: &Arc<Self>) -> Result<(), String> {
        {
            let mut s = self.state.lock().unwrap();
            if s.installing {
                return Err("SteamCMD is already being installed".into());
            }
            s.installing = true;
            s.push_log("Installing SteamCMD…");
        }
        self.emit();
        let cmd = self.steamcmd();
        let me = self.clone();
        let log = move |line: String| {
            if let Ok(mut s) = me.state.lock() {
                s.push_log(&line);
            }
            me.emit();
        };
        let result = cmd.install(&self.client, &log).await.map_err(|e| e.to_string());
        {
            let mut s = self.state.lock().unwrap();
            s.installing = false;
            s.steamcmd_installed = cmd.is_installed();
            match &result {
                Ok(()) => s.push_log("SteamCMD is ready."),
                Err(e) => s.push_log(&format!("SteamCMD install failed: {e}")),
            }
        }
        self.emit();
        self.wake();
        result
    }

    /// Where things are and whether SteamCMD is usable — for Settings and the Downloads view.
    pub fn status(&self) -> SteamCmdStatus {
        self.refresh_installed();
        let cmd = self.steamcmd();
        let console_log = cmd.console_log();
        let (mods_dir, workshop_dir) = self.app.lock().map(|a| (a.locations.local_mods_dir.clone(), a.locations.workshop_dir.clone())).unwrap_or((None, None));
        let s = self.snapshot();
        SteamCmdStatus {
            installed: s.steamcmd_installed,
            installing: s.installing,
            root: cmd.root.display().to_string(),
            exe: cmd.exe().display().to_string(),
            downloads_dir: cmd.downloads_dir().display().to_string(),
            console_log: console_log.display().to_string(),
            console_log_bytes: std::fs::metadata(&console_log).map(|m| m.len()).unwrap_or(0),
            mods_dir: mods_dir.map(|p| p.display().to_string()),
            workshop_dir: workshop_dir.map(|p| p.display().to_string()),
            queued: s.queued(),
            running: s.running,
            paused: s.paused,
            batch_size: s.throttle.batch_size,
            cooldown_until: s.throttle.cooldown_until,
        }
    }

    /// Run `+login anonymous +quit` and stream the output into the log: the quickest way to
    /// see whether SteamCMD works on this machine (and, on Windows, whether its console log
    /// reaches us).
    pub async fn test_steamcmd(self: &Arc<Self>) -> Result<circinus_core::steam::steamcmd::TestOutcome, String> {
        {
            let mut s = self.state.lock().unwrap();
            if s.installing {
                return Err("SteamCMD is still being installed".into());
            }
            if s.running {
                return Err("A download batch is running. Try again when it finishes".into());
            }
            if !s.steamcmd_installed {
                return Err("SteamCMD is not installed yet".into());
            }
            s.push_log("Test: login anonymous, then quit…");
        }
        self.emit();
        let cmd = self.steamcmd();
        let me = self.clone();
        let mut last_emit = std::time::Instant::now();
        let mut on_line = move |line: &str| {
            if let Ok(mut s) = me.state.lock() {
                s.push_log(line);
            }
            if last_emit.elapsed() > std::time::Duration::from_millis(300) {
                me.emit();
                last_emit = std::time::Instant::now();
            }
        };
        let result = cmd.test(&mut on_line).await.map_err(|e| e.to_string());
        {
            let mut s = self.state.lock().unwrap();
            match &result {
                Ok(t) if t.logged_in => s.push_log(&format!("Test passed: anonymous login in {} s, {} lines of output.", t.seconds, t.lines)),
                Ok(t) if t.stalled => s.push_log("Test failed: SteamCMD produced no output and was stopped."),
                Ok(t) => s.push_log(&format!("Test finished without a login confirmation (exit code {:?}, {} lines).", t.exit_code, t.lines)),
                Err(e) => s.push_log(&format!("Test failed: {e}")),
            }
        }
        self.emit();
        result
    }

    async fn run(self: Arc<Self>) {
        loop {
            // Wait for work.
            let (ready, wait_ms) = {
                let s = self.state.lock().unwrap();
                let remaining = s.throttle.remaining_cooldown(now());
                let ready = !s.paused && !s.installing && s.steamcmd_installed && s.queued() > 0 && remaining == 0;
                (ready, if remaining > 0 { 1000 } else { 30_000 })
            };
            if !ready {
                tokio::select! {
                    _ = self.notify.notified() => {}
                    _ = tokio::time::sleep(std::time::Duration::from_millis(wait_ms)) => {}
                }
                if wait_ms == 1000 {
                    self.emit(); // cooldown countdown
                }
                continue;
            }
            let batch = {
                let mut s = self.state.lock().unwrap();
                let batch = s.next_batch();
                for item in s.items.iter_mut() {
                    if batch.iter().any(|(id, _)| *id == item.id) {
                        item.status = ItemStatus::Downloading;
                    }
                }
                s.current_batch = batch.iter().map(|(id, _)| *id).collect();
                s.running = true;
                let size = s.throttle.batch_size;
                s.push_log(&format!("Batch of {} (batch size {})", batch.len(), size));
                batch
            };
            self.persist();
            self.emit();
            let cmd = self.steamcmd();
            // Everything SteamCMD still lists, not only this batch: an item left on its list with
            // no files trips up the next download that shares a file with it, and SteamCMD then
            // downloads it again in the background of that batch.
            if let Ok(forgotten) = cmd.forget_everything() {
                let stale = forgotten.iter().filter(|id| !batch.iter().any(|(b, _)| b == *id)).count();
                if stale > 0 {
                    if let Ok(mut s) = self.state.lock() {
                        s.push_log(&format!("Cleared {stale} items SteamCMD was still holding from earlier batches"));
                    }
                }
            }
            let me = self.clone();
            let mut last_emit = std::time::Instant::now();
            let mut on_line = move |line: &str| {
                if let Ok(mut s) = me.state.lock() {
                    s.push_log(line);
                    if let circinus_core::steam::steamcmd::LineEvent::Downloading(id) = circinus_core::steam::steamcmd::parse_line(line) {
                        s.current_item = Some(id);
                    }
                }
                if last_emit.elapsed() > std::time::Duration::from_millis(300) {
                    me.emit();
                    last_emit = std::time::Instant::now();
                }
            };
            let outcome = cmd.run_batch(&batch, STALL_TIMEOUT, &mut on_line).await;
            let (mods_dir, workshop_dir) = self.app.lock().map(|a| (a.locations.local_mods_dir.clone(), a.locations.workshop_dir.clone())).unwrap_or((None, None));
            let mut any_done = false;
            match outcome {
                Ok(outcome) => {
                    let done = {
                        let mut s = self.state.lock().unwrap();
                        s.apply(&outcome, now())
                    };
                    for id in done {
                        let into_steam = self.state.lock().ok().and_then(|s| s.items.iter().find(|i| i.id == id).and_then(|i| i.into_steam.clone()));
                        let placed = match placement(into_steam.as_deref().map(Path::new), mods_dir.as_deref(), workshop_dir.as_deref()) {
                            Placement::SteamCopy(copy) => cmd.replace_workshop_copy(id, &copy).map(|p| p.display().to_string()).map_err(|e| format!("Downloaded but could not be put in Steam's folder: {e}")),
                            Placement::Mods(dir) => cmd.collect(id, &dir).map(|p| p.display().to_string()).map_err(|e| format!("Downloaded but could not be moved into Mods: {e}")),
                            Placement::Refused(why) => Err(why),
                        };
                        let mut s = self.state.lock().unwrap();
                        if let Some(item) = s.items.iter_mut().find(|i| i.id == id) {
                            match placed {
                                Ok(p) => {
                                    item.path = Some(p);
                                    any_done = true;
                                }
                                Err(e) => {
                                    item.status = ItemStatus::Failed;
                                    item.error = Some(e);
                                }
                            }
                        }
                    }
                    let mut s = self.state.lock().unwrap();
                    let (cool, size) = (s.throttle.remaining_cooldown(now()), s.throttle.batch_size);
                    let msg = match cool {
                        0 => format!("Batch done in {} s; next batch size {}", outcome.seconds, size),
                        c => format!("Steam is refusing downloads. Waiting {c} s, batch size now {size}"),
                    };
                    s.push_log(&msg);
                }
                Err(e) => {
                    let mut s = self.state.lock().unwrap();
                    s.push_log(&format!("SteamCMD could not run: {e}"));
                    for item in s.items.iter_mut().filter(|i| i.status == ItemStatus::Downloading) {
                        item.status = ItemStatus::Queued;
                    }
                    s.current_batch.clear();
                    s.paused = true;
                }
            }
            {
                let mut s = self.state.lock().unwrap();
                s.running = false;
            }
            self.persist();
            self.emit();
            if any_done {
                let handle = self.handle.clone();
                let app = self.app.clone();
                tauri::async_runtime::spawn_blocking(move || crate::run_scan(handle, app, false));
            }
            tokio::time::sleep(BATCH_PAUSE).await;
        }
    }
}

//! SteamCMD: install on first use, download workshop items in batches, and the smart throttle
//! that keeps Steam from locking us out.
//!
//! Facts about SteamCMD this relies on (they are behaviours of Valve's tool, not our design):
//! more than ~25 items per script trips an internal profiler limit and aborts; anonymous login
//! is enough for RimWorld workshop items; output is unreliable on a pipe on Windows, so the
//! console log is tailed as well; a moved-away item must be forgotten in the workshop ACF or
//! SteamCMD will believe it is still installed and skip it. It also builds a download out of
//! identical chunks it believes it already has on disk, so a later item that shares a file with a
//! moved-away one reads that file from the missing folder, fails with "Missing game files", and
//! sets off a validation that downloads every listed item with no files again, alongside the
//! batch it was running (`examples/steamcmd_lab.rs` reproduces it).

use crate::model::RIMWORLD_APP_ID;
use crate::steam::acf;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub const MAX_BATCH: usize = 25;
pub const MIN_BATCH: usize = 3;
pub const MAX_ATTEMPTS: u32 = 4;
/// No output for this long means SteamCMD is wedged (Steam silently stalls large items).
pub const STALL_TIMEOUT: Duration = Duration::from_secs(150);
/// A polite pause between batches even when everything is healthy.
pub const BATCH_PAUSE: Duration = Duration::from_secs(3);

#[cfg(target_os = "windows")]
const DOWNLOAD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
#[cfg(target_os = "macos")]
const DOWNLOAD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz";
#[cfg(all(unix, not(target_os = "macos")))]
const DOWNLOAD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";

/// Paths of one SteamCMD prefix: `<root>/steamcmd` holds the tool, `<root>/steam` is the
/// install root SteamCMD downloads into.
#[derive(Debug, Clone)]
pub struct SteamCmd {
    pub root: PathBuf,
}

impl SteamCmd {
    pub fn new(root: PathBuf) -> SteamCmd {
        SteamCmd { root }
    }
    pub fn tool_dir(&self) -> PathBuf {
        self.root.join("steamcmd")
    }
    pub fn exe(&self) -> PathBuf {
        if cfg!(target_os = "windows") {
            self.tool_dir().join("steamcmd.exe")
        } else {
            self.tool_dir().join("steamcmd.sh")
        }
    }
    pub fn install_dir(&self) -> PathBuf {
        self.root.join("steam")
    }
    pub fn downloads_dir(&self) -> PathBuf {
        self.install_dir().join("steamapps").join("workshop").join("content").join(RIMWORLD_APP_ID.to_string())
    }
    pub fn acf_path(&self) -> PathBuf {
        self.install_dir().join("steamapps").join("workshop").join(format!("appworkshop_{RIMWORLD_APP_ID}.acf"))
    }
    pub fn console_log(&self) -> PathBuf {
        self.tool_dir().join("logs").join("console_log.txt")
    }
    pub fn is_installed(&self) -> bool {
        self.exe().is_file()
    }

    /// Download and unpack SteamCMD, then run it once so it can update itself.
    pub async fn install(&self, client: &reqwest::Client, log: &(dyn Fn(String) + Sync)) -> Result<()> {
        std::fs::create_dir_all(self.tool_dir())?;
        std::fs::create_dir_all(self.install_dir())?;
        log(format!("Downloading SteamCMD from {DOWNLOAD_URL}"));
        let bytes = client.get(DOWNLOAD_URL).send().await?.error_for_status()?.bytes().await?;
        log(format!("Unpacking {} KB", bytes.len() / 1024));
        let dir = self.tool_dir();
        tokio::task::spawn_blocking(move || unpack(&bytes, &dir)).await.map_err(|e| Error::Other(e.to_string()))??;
        if !self.is_installed() {
            return Err(Error::Other("SteamCMD archive did not contain the expected executable".into()));
        }
        log("First run: SteamCMD updates itself (this can take a minute)".into());
        let out = self.run_raw(&["+quit".to_string()], Duration::from_secs(600), &mut |l| log(l.to_string())).await?;
        if out.stalled {
            return Err(Error::Other("SteamCMD did not finish its first-run update".into()));
        }
        Ok(())
    }

    /// Log in anonymously and quit: proves the install works and that its output reaches us.
    pub async fn test(&self, on_line: &mut (dyn FnMut(&str) + Send)) -> Result<TestOutcome> {
        let started = Instant::now();
        let mut logged_in = false;
        let mut lines = 0usize;
        let raw = self
            .run_raw(&["+login".to_string(), "anonymous".to_string(), "+quit".to_string()], Duration::from_secs(180), &mut |line| {
                lines += 1;
                let lower = line.to_ascii_lowercase();
                if lower.contains("logged in ok") || lower.contains("waiting for user info...ok") || lower.contains("waiting for client config...ok") {
                    logged_in = true;
                }
                on_line(line);
            })
            .await?;
        Ok(TestOutcome { logged_in, lines, stalled: raw.stalled, exit_code: raw.exit_code, seconds: started.elapsed().as_secs() })
    }

    /// Write a runscript for a batch: (item id, validate?).
    pub fn write_script(&self, items: &[(u64, bool)]) -> Result<PathBuf> {
        let mut s = String::new();
        s.push_str("@ShutdownOnFailedCommand 0\n@NoPromptForPassword 1\n");
        s.push_str(&format!("force_install_dir \"{}\"\n", self.install_dir().display()));
        s.push_str("login anonymous\n");
        for (id, validate) in items {
            s.push_str(&format!("workshop_download_item {RIMWORLD_APP_ID} {id}{}\n", if *validate { " validate" } else { "" }));
        }
        s.push_str("quit\n");
        let path = self.root.join("batch.txt");
        std::fs::write(&path, s)?;
        Ok(path)
    }

    /// Run one batch and report per-item results.
    pub async fn run_batch(&self, items: &[(u64, bool)], stall: Duration, on_line: &mut (dyn FnMut(&str) + Send)) -> Result<BatchOutcome> {
        let script = self.write_script(items)?;
        let started = Instant::now();
        let mut results: HashMap<u64, ItemResult> = HashMap::new();
        let mut auth_failed = false;
        let mut current: Option<u64> = None;
        let raw = self
            .run_raw(&["+runscript".to_string(), script.display().to_string()], stall, &mut |line| {
                match parse_line(line) {
                    LineEvent::Downloading(id) => current = Some(id),
                    LineEvent::Success(id, path, bytes) => {
                        results.insert(id, ItemResult::Ok { path, bytes });
                    }
                    LineEvent::Failed(id, reason) => {
                        results.insert(id, ItemResult::Failed(reason));
                    }
                    LineEvent::AuthFailed(reason) => {
                        auth_failed = true;
                        on_line(&format!("Login problem: {reason}"));
                    }
                    LineEvent::Other => {}
                }
                on_line(line);
            })
            .await?;
        if raw.stalled {
            if let Some(id) = current {
                results.entry(id).or_insert(ItemResult::TimedOut);
            }
        }
        for (id, _) in items {
            results.entry(*id).or_insert(if raw.stalled || auth_failed { ItemResult::NotAttempted } else { ItemResult::Failed("SteamCMD exited without reporting this item".into()) });
        }
        Ok(BatchOutcome { results, auth_failed, stalled: raw.stalled, exit_code: raw.exit_code, seconds: started.elapsed().as_secs() })
    }

    /// Spawn SteamCMD, stream its lines (stdout, stderr and — on Windows — the console log),
    /// and kill it if it goes quiet for `stall`.
    async fn run_raw(&self, args: &[String], stall: Duration, on_line: &mut (dyn FnMut(&str) + Send)) -> Result<RawOutcome> {
        let exe = self.exe();
        if !exe.is_file() {
            return Err(Error::Other("SteamCMD is not installed yet".into()));
        }
        let log_path = self.console_log();
        let log_start = std::fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
        let mut cmd = Command::new(&exe);
        cmd.args(args).current_dir(self.tool_dir()).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut child = cmd.spawn().map_err(|e| Error::Other(format!("Could not start SteamCMD: {e}")))?;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        if let Some(out) = child.stdout.take() {
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    let _ = tx.send(l);
                }
            });
        }
        if let Some(err) = child.stderr.take() {
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    let _ = tx.send(l);
                }
            });
        }
        // Windows: SteamCMD writes progress to the console, not the pipe; tail its log file.
        let tail_stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        if cfg!(target_os = "windows") {
            let tx = tx.clone();
            let stop = tail_stop.clone();
            tokio::spawn(async move {
                let mut offset = log_start;
                let mut carry = String::new();
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    if let Ok(text) = tokio::fs::read(&log_path).await {
                        if (text.len() as u64) > offset {
                            let chunk = String::from_utf8_lossy(&text[offset as usize..]).to_string();
                            offset = text.len() as u64;
                            carry.push_str(&chunk);
                            while let Some(nl) = carry.find('\n') {
                                let line = carry[..nl].trim_end_matches('\r').to_string();
                                carry = carry[nl + 1..].to_string();
                                let _ = tx.send(line);
                            }
                        }
                    }
                }
            });
        }
        drop(tx);
        let mut stalled = false;
        let mut exit_code = None;
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        loop {
            tokio::select! {
                line = rx.recv() => {
                    match line {
                        Some(l) => {
                            let clean = strip_ansi(&l);
                            let clean = clean.trim();
                            if clean.is_empty() { continue; }
                            // stdout and the log file can carry the same line; report each once.
                            if seen.insert(clean.to_string()) { on_line(clean); }
                        }
                        None => break,
                    }
                }
                status = child.wait() => {
                    exit_code = status.ok().and_then(|s| s.code());
                    // drain whatever is left, briefly
                    let deadline = Instant::now() + Duration::from_secs(2);
                    while let Ok(Some(l)) = tokio::time::timeout_at(tokio::time::Instant::from_std(deadline), rx.recv()).await {
                        let clean = strip_ansi(&l);
                        let clean = clean.trim();
                        if !clean.is_empty() && seen.insert(clean.to_string()) { on_line(clean); }
                    }
                    break;
                }
                _ = tokio::time::sleep(stall) => {
                    stalled = true;
                    on_line("No output from SteamCMD for too long. Stopping it");
                    let _ = child.kill().await;
                    break;
                }
            }
        }
        tail_stop.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(RawOutcome { stalled, exit_code })
    }

    /// Move a finished download into the Mods folder as `<id>` and mark it as a SteamCMD mod.
    pub fn collect(&self, id: u64, mods_dir: &Path) -> Result<PathBuf> {
        let src = self.downloads_dir().join(id.to_string());
        if !src.is_dir() {
            return Err(Error::Other(format!("SteamCMD reported success but {} is missing", src.display())));
        }
        std::fs::create_dir_all(mods_dir)?;
        let dest = mods_dir.join(id.to_string());
        if dest.exists() {
            std::fs::remove_dir_all(&dest)?;
        }
        move_dir(&src, &dest)?;
        // The files have left SteamCMD's install, so its record of them has to go as well: a later
        // download sharing a file with a listed item reads it from here, and finding it gone is
        // what sets off SteamCMD's repair (see the module header). Failing to rewrite the ACF does
        // not undo a move that worked, and `forget_everything` takes the entry off before the next
        // batch in any case.
        if let Err(e) = self.unlist(&[id]) {
            tracing::warn!(id, error = %e, "moved a download into Mods but could not take it off SteamCMD's workshop ACF");
        }
        let about = dest.join("About");
        std::fs::create_dir_all(&about)?;
        let marker = about.join("PublishedFileId.txt");
        if !marker.exists() {
            std::fs::write(marker, id.to_string())?;
        }
        Ok(dest)
    }

    /// Replace a subscribed mod's folder in Steam's library with a finished download: Force
    /// update of a Steam mod. The new version goes where Steam keeps the mod. A second copy in
    /// Mods would be loaded by RimWorld instead of Steam's, and later Steam updates would never
    /// be used.
    ///
    /// Steam's own record (`appworkshop_294100.acf` in its library) is not written. Steam rewrites
    /// that file while it runs, and a second writer could corrupt the whole subscription list. The
    /// record keeps naming the old version until Steam's next check. Nothing is replaced while
    /// Steam is downloading the same item, since two writers in one folder would leave a broken
    /// mod. The old copy is moved outside the content folder, where neither RimWorld nor a scan
    /// treats it as a mod, and is deleted only once the new one is in place; if the new one cannot
    /// be moved in, the old one is moved back. The whole folder is replaced, so files that were
    /// never part of the mod (such as DDS textures a converter wrote) are dropped, as they would
    /// be on a fresh subscription.
    pub fn replace_workshop_copy(&self, id: u64, steam_copy: &Path) -> Result<PathBuf> {
        let src = self.downloads_dir().join(id.to_string());
        if !src.is_dir() {
            return Err(Error::Other(format!("SteamCMD reported success but {} is missing", src.display())));
        }
        let named_for_item = steam_copy.file_name().is_some_and(|n| n.to_string_lossy() == id.to_string());
        if !named_for_item || !steam_copy.is_dir() {
            return Err(Error::Other(format!("Steam's copy of {id} is not at {}, so nothing was replaced", steam_copy.display())));
        }
        // `<library>/steamapps/workshop/content/294100/<id>`: three levels up is the workshop
        // folder, where Steam also stages the downloads it has not finished.
        let workshop = steam_copy.parent().and_then(Path::parent).and_then(Path::parent).ok_or_else(|| Error::Other(format!("{} is not inside a Steam library", steam_copy.display())))?;
        if workshop.join("downloads").join(RIMWORLD_APP_ID.to_string()).join(id.to_string()).exists() {
            return Err(Error::Other("Steam is downloading this mod itself right now, so its copy was left alone. Try again once Steam has finished".into()));
        }
        let aside = workshop.join(format!("circinus-replaced-{id}"));
        if aside.exists() {
            std::fs::remove_dir_all(&aside)?;
        }
        std::fs::rename(steam_copy, &aside).map_err(|e| Error::Other(format!("Could not move Steam's copy of {id} aside, so nothing was changed ({e}). If RimWorld is running, close it and try again")))?;
        if let Err(e) = move_dir(&src, steam_copy) {
            let _ = std::fs::remove_dir_all(steam_copy);
            return Err(match std::fs::rename(&aside, steam_copy) {
                Ok(()) => Error::Other(format!("Could not put the new version in Steam's folder, so Steam's copy was restored ({e})")),
                Err(back) => Error::Other(format!("Could not put the new version in Steam's folder ({e}), nor move Steam's copy back from {} ({back}). Steam should download the mod again the next time it checks", aside.display())),
            });
        }
        if let Err(e) = self.unlist(&[id]) {
            tracing::warn!(id, error = %e, "replaced Steam's copy but could not take the download off SteamCMD's workshop ACF");
        }
        if let Err(e) = std::fs::remove_dir_all(&aside) {
            tracing::warn!(id, error = %e, path = %aside.display(), "replaced Steam's copy but could not delete the old one");
        }
        Ok(steam_copy.to_path_buf())
    }

    /// Forget everything SteamCMD still lists or holds, ahead of a batch, and return those ids.
    ///
    /// SteamCMD's install is only a staging area. `collect` moves each finished item into Mods and
    /// removes it from the workshop ACF, so between batches it should be empty. Anything left is
    /// either a download that never made it into Mods, which a retry fetches again anyway, or a
    /// copy SteamCMD made by itself: when a download fails reading a file shared with a listed
    /// item whose folder is gone, SteamCMD validates everything it lists and downloads the missing
    /// items again during the batch. Earlier builds left moved items on that list, so existing
    /// installs can hold hundreds of megabytes of these copies, and a list that keeps producing
    /// more.
    pub fn forget_everything(&self) -> Result<Vec<u64>> {
        let mut ids = BTreeSet::new();
        if let Ok(text) = std::fs::read_to_string(self.acf_path()) {
            ids.extend(acf::listed_items(&text));
        }
        if let Ok(entries) = std::fs::read_dir(self.downloads_dir()) {
            ids.extend(entries.flatten().filter_map(|e| e.file_name().to_str().and_then(|n| n.parse::<u64>().ok())));
        }
        let ids: Vec<u64> = ids.into_iter().collect();
        self.forget(&ids)?;
        Ok(ids)
    }

    /// Take items off SteamCMD's workshop ACF and leave the rest of the file alone. An ACF that
    /// cannot be read, which is every install before its first download, is left as it is.
    fn unlist(&self, ids: &[u64]) -> Result<()> {
        let acf = self.acf_path();
        let Ok(text) = std::fs::read_to_string(&acf) else { return Ok(()) };
        let (new_text, removed) = acf::forget_items(&text, ids);
        if !removed.is_empty() {
            std::fs::write(&acf, new_text)?;
        }
        Ok(())
    }

    /// Make SteamCMD forget items so a later download really downloads: purge them from the
    /// workshop ACF and clear caches that would otherwise short-circuit the fetch.
    pub fn forget(&self, ids: &[u64]) -> Result<()> {
        self.unlist(ids)?;
        for dir in [self.tool_dir().join("depotcache"), self.install_dir().join("depotcache"), self.install_dir().join("steamapps").join("workshop").join("downloads"), self.install_dir().join("steamapps").join("workshop").join("temp")] {
            if dir.exists() {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        for id in ids {
            let leftover = self.downloads_dir().join(id.to_string());
            if leftover.exists() {
                let _ = std::fs::remove_dir_all(&leftover);
            }
        }
        Ok(())
    }
}

fn unpack(bytes: &[u8], dir: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| Error::Other(format!("bad zip: {e}")))?;
        archive.extract(dir).map_err(|e| Error::Other(format!("unzip failed: {e}")))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let gz = flate2::read::GzDecoder::new(bytes);
        let mut tar = tar::Archive::new(gz);
        tar.unpack(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for name in ["steamcmd.sh", "steamcmd"] {
                let p = dir.join(name);
                if p.exists() {
                    let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755));
                }
            }
        }
    }
    Ok(())
}

/// Where a finished download goes, decided before anything on disk is touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Placement {
    /// Replace Steam's copy in this folder: a Force update of a Steam mod.
    SteamCopy(PathBuf),
    /// Into `Mods/<id>` under this folder, where every other download goes.
    Mods(PathBuf),
    /// Nowhere, for the reason given. The download stays in SteamCMD's folder, and the sweep
    /// before the next batch clears it.
    Refused(String),
}

/// Decide where a finished download goes. `into_steam` is the queue item's Steam folder, which
/// was checked when the update was queued. The queue survives a restart, and that folder is about
/// to be deleted and rewritten, so it must still be directly inside the Workshop folder Circinus
/// reads now. A refused Steam update is not put in Mods instead: RimWorld would load that copy
/// instead of Steam's, which is the problem Force update of a Steam mod is there to avoid.
pub fn placement(into_steam: Option<&Path>, mods_dir: Option<&Path>, workshop_dir: Option<&Path>) -> Placement {
    match (into_steam, mods_dir) {
        (Some(copy), _) if workshop_dir.is_some_and(|ws| copy.parent() == Some(ws)) => Placement::SteamCopy(copy.to_path_buf()),
        (Some(copy), _) => Placement::Refused(format!("Downloaded, but {} is no longer in the Workshop folder Circinus reads, so nothing was replaced", copy.display())),
        (None, Some(dir)) => Placement::Mods(dir.to_path_buf()),
        (None, None) => Placement::Refused("Downloaded but could not be moved into Mods: no local Mods folder is configured".into()),
    }
}

/// Rename, falling back to copy + delete across drives.
pub fn move_dir(src: &Path, dest: &Path) -> Result<()> {
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    copy_dir(src, dest)?;
    std::fs::remove_dir_all(src)?;
    Ok(())
}

fn copy_dir(src: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub struct RawOutcome {
    pub stalled: bool,
    pub exit_code: Option<i32>,
}

/// Result of `SteamCmd::test`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestOutcome {
    /// SteamCMD reported an anonymous login.
    pub logged_in: bool,
    /// Lines of output that reached Circinus (0 on Windows means the console-log tail failed).
    pub lines: usize,
    pub stalled: bool,
    pub exit_code: Option<i32>,
    pub seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemResult {
    Ok { path: PathBuf, bytes: u64 },
    Failed(String),
    TimedOut,
    /// The batch died before SteamCMD reached this item; it costs no attempt.
    NotAttempted,
}

#[derive(Debug)]
pub struct BatchOutcome {
    pub results: HashMap<u64, ItemResult>,
    pub auth_failed: bool,
    pub stalled: bool,
    pub exit_code: Option<i32>,
    pub seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineEvent {
    Downloading(u64),
    Success(u64, PathBuf, u64),
    Failed(u64, String),
    AuthFailed(String),
    Other,
}

fn strip_ansi(s: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]").unwrap());
    re.replace_all(s, "").to_string()
}

/// Classify one line of SteamCMD output.
pub fn parse_line(line: &str) -> LineEvent {
    static DOWNLOADING: OnceLock<regex::Regex> = OnceLock::new();
    static SUCCESS: OnceLock<regex::Regex> = OnceLock::new();
    static FAILED: OnceLock<regex::Regex> = OnceLock::new();
    static TIMEOUT: OnceLock<regex::Regex> = OnceLock::new();
    let downloading = DOWNLOADING.get_or_init(|| regex::Regex::new(r"Downloading item (\d+)").unwrap());
    let success = SUCCESS.get_or_init(|| regex::Regex::new(r#"Success\. Downloaded item (\d+) to "([^"]+)" \((\d+) bytes\)"#).unwrap());
    let failed = FAILED.get_or_init(|| regex::Regex::new(r"Download item (\d+) failed \(([^)]*)\)").unwrap());
    let timeout = TIMEOUT.get_or_init(|| regex::Regex::new(r"Timeout downloading item (\d+)").unwrap());
    if let Some(c) = success.captures(line) {
        return LineEvent::Success(c[1].parse().unwrap_or(0), PathBuf::from(&c[2]), c[3].parse().unwrap_or(0));
    }
    if let Some(c) = failed.captures(line) {
        return LineEvent::Failed(c[1].parse().unwrap_or(0), c[2].to_string());
    }
    if let Some(c) = timeout.captures(line) {
        return LineEvent::Failed(c[1].parse().unwrap_or(0), "Timeout".into());
    }
    if let Some(c) = downloading.captures(line) {
        return LineEvent::Downloading(c[1].parse().unwrap_or(0));
    }
    let lower = line.to_ascii_lowercase();
    if lower.contains("not logged on") || lower.contains("login failure") || (lower.contains("failed") && lower.contains("rate limit")) || lower.contains("rate limit exceeded") {
        return LineEvent::AuthFailed(line.trim().to_string());
    }
    LineEvent::Other
}

/// Adaptive batch size and exponential cooldown, updated after every batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Throttle {
    pub batch_size: usize,
    pub clean_streak: u32,
    /// 0 = calm; each throttled batch raises it, each clean batch lowers it.
    pub level: u32,
    /// Unix seconds until which no batch may start.
    pub cooldown_until: Option<i64>,
    pub last: Option<BatchStats>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStats {
    pub requested: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub timed_out: usize,
    pub auth_failed: bool,
    pub stalled: bool,
    pub seconds: u64,
}

impl Default for Throttle {
    fn default() -> Self {
        Throttle { batch_size: MAX_BATCH, clean_streak: 0, level: 0, cooldown_until: None, last: None }
    }
}

impl Throttle {
    pub fn cooldown_seconds(level: u32) -> i64 {
        if level == 0 {
            0
        } else {
            (30i64 * (1i64 << (level - 1).min(5))).min(600)
        }
    }

    pub fn after_batch(&mut self, s: &BatchStats, now: i64) {
        let bad = s.failed + s.timed_out;
        let throttled = s.auth_failed || s.stalled || (s.requested > 0 && bad * 2 >= s.requested);
        if throttled {
            self.level += 1;
            self.clean_streak = 0;
            self.batch_size = (self.batch_size / 2).max(MIN_BATCH);
            self.cooldown_until = Some(now + Self::cooldown_seconds(self.level));
        } else if bad > 0 {
            self.clean_streak = 0;
            self.batch_size = (self.batch_size * 2 / 3).max(MIN_BATCH);
            self.cooldown_until = None;
        } else {
            self.clean_streak += 1;
            self.level = self.level.saturating_sub(1);
            self.cooldown_until = None;
            if self.clean_streak >= 2 {
                self.batch_size = (self.batch_size * 3 / 2).clamp(MIN_BATCH, MAX_BATCH);
            }
        }
        self.last = Some(s.clone());
    }

    pub fn remaining_cooldown(&self, now: i64) -> i64 {
        self.cooldown_until.map(|t| (t - now).max(0)).unwrap_or(0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Queued,
    Downloading,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub status: ItemStatus,
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub added_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    /// Steam's folder for this item, when it is a Force update of a subscribed mod: the download
    /// replaces the copy there rather than becoming a second one in Mods. Unset, it goes to
    /// `Mods/<id>` as every download always has.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub into_steam: Option<String>,
}

/// The persistent download queue plus the live state the UI renders.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QueueState {
    pub items: Vec<QueueItem>,
    pub throttle: Throttle,
    pub paused: bool,
    /// Ids in the batch SteamCMD is working on right now.
    pub current_batch: Vec<u64>,
    /// Item SteamCMD last reported as downloading.
    pub current_item: Option<u64>,
    pub running: bool,
    pub steamcmd_installed: bool,
    pub installing: bool,
    /// Last lines of SteamCMD output, newest last.
    pub log: Vec<String>,
}

impl QueueState {
    /// Add ids; an id already queued or downloading is left alone, a finished or failed one is
    /// re-queued.
    pub fn add(&mut self, ids: &[u64], names: &HashMap<u64, String>, now: i64) -> usize {
        self.add_to(ids, &HashMap::new(), names, now)
    }

    /// `add`, where the ids in `into_steam` replace Steam's copy at that folder.
    ///
    /// A finished id queued again goes wherever the new request says. One still waiting keeps a
    /// Steam destination unless the new request names another: a plain download arriving second
    /// must not turn a Force update into a second copy in Mods. Once SteamCMD has the id, it goes
    /// where it was queued.
    pub fn add_to(&mut self, ids: &[u64], into_steam: &HashMap<u64, String>, names: &HashMap<u64, String>, now: i64) -> usize {
        let mut added = 0;
        for id in ids {
            match self.items.iter_mut().find(|i| i.id == *id) {
                Some(existing) => {
                    if matches!(existing.status, ItemStatus::Done | ItemStatus::Failed | ItemStatus::Cancelled) {
                        existing.status = ItemStatus::Queued;
                        existing.attempts = 0;
                        existing.error = None;
                        existing.finished_at = None;
                        existing.into_steam = into_steam.get(id).cloned();
                        added += 1;
                    } else if existing.status == ItemStatus::Queued {
                        if let Some(dest) = into_steam.get(id) {
                            existing.into_steam = Some(dest.clone());
                        }
                    }
                    if existing.name.is_none() {
                        existing.name = names.get(id).cloned();
                    }
                }
                None => {
                    self.items.push(QueueItem { id: *id, name: names.get(id).cloned(), status: ItemStatus::Queued, attempts: 0, error: None, bytes: None, path: None, added_at: now, finished_at: None, into_steam: into_steam.get(id).cloned() });
                    added += 1;
                }
            }
        }
        added
    }

    pub fn remove(&mut self, ids: &[u64]) {
        self.items.retain(|i| !(ids.contains(&i.id) && i.status != ItemStatus::Downloading));
        for i in self.items.iter_mut().filter(|i| ids.contains(&i.id) && i.status == ItemStatus::Downloading) {
            i.status = ItemStatus::Cancelled;
        }
    }

    pub fn retry_failed(&mut self) -> usize {
        let mut n = 0;
        for i in self.items.iter_mut().filter(|i| i.status == ItemStatus::Failed) {
            i.status = ItemStatus::Queued;
            i.attempts = 0;
            i.error = None;
            n += 1;
        }
        n
    }

    pub fn clear_finished(&mut self) {
        self.items.retain(|i| !matches!(i.status, ItemStatus::Done | ItemStatus::Cancelled));
    }

    /// The next batch to run: (id, validate) — validate after the first failure.
    pub fn next_batch(&self) -> Vec<(u64, bool)> {
        self.items.iter().filter(|i| i.status == ItemStatus::Queued).take(self.throttle.batch_size.max(1)).map(|i| (i.id, i.attempts > 0)).collect()
    }

    pub fn queued(&self) -> usize {
        self.items.iter().filter(|i| i.status == ItemStatus::Queued).count()
    }

    /// Fold a batch outcome into the items. Returns the ids that were downloaded successfully.
    pub fn apply(&mut self, outcome: &BatchOutcome, now: i64) -> Vec<u64> {
        let mut done = Vec::new();
        for item in self.items.iter_mut().filter(|i| outcome.results.contains_key(&i.id)) {
            match &outcome.results[&item.id] {
                ItemResult::Ok { path, bytes } => {
                    item.status = ItemStatus::Done;
                    item.bytes = Some(*bytes);
                    item.path = Some(path.display().to_string());
                    item.error = None;
                    item.finished_at = Some(now);
                    done.push(item.id);
                }
                ItemResult::NotAttempted => {
                    if item.status != ItemStatus::Cancelled {
                        item.status = ItemStatus::Queued;
                    }
                }
                other => {
                    let reason = match other {
                        ItemResult::Failed(r) => r.clone(),
                        _ => "Timed out".to_string(),
                    };
                    item.attempts += 1;
                    item.error = Some(reason);
                    item.status = if item.attempts >= MAX_ATTEMPTS { ItemStatus::Failed } else { ItemStatus::Queued };
                    if item.status == ItemStatus::Failed {
                        item.finished_at = Some(now);
                    }
                }
            }
        }
        let stats = BatchStats {
            requested: outcome.results.values().filter(|r| !matches!(r, ItemResult::NotAttempted)).count(),
            succeeded: done.len(),
            failed: outcome.results.values().filter(|r| matches!(r, ItemResult::Failed(_))).count(),
            timed_out: outcome.results.values().filter(|r| matches!(r, ItemResult::TimedOut)).count(),
            auth_failed: outcome.auth_failed,
            stalled: outcome.stalled,
            seconds: outcome.seconds,
        };
        self.throttle.after_batch(&stats, now);
        self.current_batch.clear();
        self.current_item = None;
        done
    }

    pub fn push_log(&mut self, line: &str) {
        self.log.push(line.to_string());
        if self.log.len() > 200 {
            let drop = self.log.len() - 200;
            self.log.drain(..drop);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_steamcmd_lines() {
        assert_eq!(parse_line("Downloading item 2009463077 ..."), LineEvent::Downloading(2009463077));
        assert_eq!(parse_line(r#"Success. Downloaded item 2009463077 to "C:\x\steamapps\workshop\content\294100\2009463077" (935611 bytes) "#), LineEvent::Success(2009463077, PathBuf::from(r"C:\x\steamapps\workshop\content\294100\2009463077"), 935611));
        assert_eq!(parse_line("ERROR! Download item 818773962 failed (Failure)."), LineEvent::Failed(818773962, "Failure".into()));
        assert_eq!(parse_line("ERROR! Timeout downloading item 818773962"), LineEvent::Failed(818773962, "Timeout".into()));
        assert_eq!(parse_line("ERROR! Not logged on."), LineEvent::AuthFailed("ERROR! Not logged on.".into()));
        assert_eq!(parse_line("FAILED (Rate Limit Exceeded)"), LineEvent::AuthFailed("FAILED (Rate Limit Exceeded)".into()));
        assert_eq!(parse_line("Waiting for user info...OK"), LineEvent::Other);
        assert_eq!(strip_ansi("\x1b[0mLoading Steam API...OK\x1b[0m"), "Loading Steam API...OK");
    }

    #[test]
    fn throttle_backs_off_and_recovers() {
        let mut t = Throttle::default();
        assert_eq!(t.batch_size, 25);
        let bad = BatchStats { requested: 25, succeeded: 5, failed: 20, timed_out: 0, auth_failed: false, stalled: false, seconds: 60 };
        t.after_batch(&bad, 1000);
        assert_eq!(t.batch_size, 12);
        assert_eq!(t.level, 1);
        assert_eq!(t.remaining_cooldown(1000), 30);
        t.after_batch(&bad, 2000);
        assert_eq!(t.batch_size, 6);
        assert_eq!(t.remaining_cooldown(2000), 60);
        let ok = BatchStats { requested: 6, succeeded: 6, failed: 0, timed_out: 0, auth_failed: false, stalled: false, seconds: 30 };
        t.after_batch(&ok, 3000);
        assert_eq!(t.level, 1);
        assert_eq!(t.remaining_cooldown(3000), 0);
        assert_eq!(t.batch_size, 6);
        t.after_batch(&ok, 3100);
        assert_eq!(t.batch_size, 9);
        assert_eq!(t.level, 0);
        for _ in 0..10 {
            t.after_batch(&ok, 4000);
        }
        assert_eq!(t.batch_size, 25);
        let stalled = BatchStats { requested: 25, succeeded: 24, failed: 0, timed_out: 1, auth_failed: false, stalled: true, seconds: 200 };
        t.after_batch(&stalled, 5000);
        assert_eq!(t.batch_size, 12);
        assert!(t.remaining_cooldown(5000) > 0);
        assert_eq!(Throttle::cooldown_seconds(9), 600);
    }

    #[test]
    fn queue_lifecycle() {
        let mut q = QueueState::default();
        let mut names = HashMap::new();
        names.insert(1u64, "One".to_string());
        assert_eq!(q.add(&[1, 2, 3], &names, 10), 3);
        assert_eq!(q.add(&[1], &names, 11), 0);
        assert_eq!(q.next_batch(), vec![(1, false), (2, false), (3, false)]);
        let mut results = HashMap::new();
        results.insert(1, ItemResult::Ok { path: PathBuf::from("/x/1"), bytes: 10 });
        results.insert(2, ItemResult::Failed("Failure".into()));
        results.insert(3, ItemResult::NotAttempted);
        let outcome = BatchOutcome { results, auth_failed: false, stalled: true, exit_code: None, seconds: 5 };
        let done = q.apply(&outcome, 20);
        assert_eq!(done, vec![1]);
        assert_eq!(q.items[0].status, ItemStatus::Done);
        assert_eq!(q.items[1].status, ItemStatus::Queued);
        assert_eq!(q.items[1].attempts, 1);
        assert_eq!(q.items[2].attempts, 0);
        assert_eq!(q.next_batch(), vec![(2, true), (3, false)]);
        for _ in 0..3 {
            let mut r = HashMap::new();
            r.insert(2, ItemResult::Failed("Failure".into()));
            q.apply(&BatchOutcome { results: r, auth_failed: false, stalled: false, exit_code: Some(0), seconds: 1 }, 30);
        }
        assert_eq!(q.items[1].status, ItemStatus::Failed);
        assert_eq!(q.retry_failed(), 1);
        q.clear_finished();
        assert_eq!(q.items.len(), 2);
        q.remove(&[3]);
        assert_eq!(q.items.len(), 1);
    }

    /// A SteamCMD install whose workshop ACF lists `listed` and whose content folder holds
    /// `on_disk`, the two being free to disagree the way a real install's can.
    fn staged(root: &Path, listed: &[u64], on_disk: &[u64]) -> SteamCmd {
        let cmd = SteamCmd::new(root.to_path_buf());
        for id in on_disk {
            let about = cmd.downloads_dir().join(id.to_string()).join("About");
            std::fs::create_dir_all(&about).unwrap();
            std::fs::write(about.join("About.xml"), "<ModMetaData/>").unwrap();
        }
        let entries = |fields: &str| listed.iter().map(|id| format!("\t\t\"{id}\"\n\t\t{{\n{fields}\t\t}}\n")).collect::<String>();
        let text = format!(
            "\"AppWorkshop\"\n{{\n\t\"appid\"\t\t\"294100\"\n\t\"WorkshopItemsInstalled\"\n\t{{\n{}\t}}\n\t\"WorkshopItemDetails\"\n\t{{\n{}\t}}\n}}\n",
            entries("\t\t\t\"size\"\t\t\"1\"\n\t\t\t\"manifest\"\t\t\"7\"\n"),
            entries("\t\t\t\"manifest\"\t\t\"7\"\n"),
        );
        std::fs::create_dir_all(cmd.acf_path().parent().unwrap()).unwrap();
        std::fs::write(cmd.acf_path(), text).unwrap();
        cmd
    }

    #[test]
    fn collect_takes_the_moved_item_off_steamcmds_list() {
        let dir = tempfile::tempdir().unwrap();
        let cmd = staged(&dir.path().join("steamcmd"), &[111, 222], &[111, 222]);
        let mods = dir.path().join("Mods");
        let placed = cmd.collect(111, &mods).unwrap();
        assert_eq!(placed, mods.join("111"));
        assert_eq!(std::fs::read_to_string(placed.join("About").join("PublishedFileId.txt")).unwrap(), "111");
        assert!(!cmd.downloads_dir().join("111").exists());
        // An item listed with no files is what SteamCMD downloads again once a later download
        // shares a file with it. The item still staged keeps its entry until it is collected.
        let text = std::fs::read_to_string(cmd.acf_path()).unwrap();
        assert_eq!(acf::listed_items(&text), vec![222]);
    }

    #[test]
    fn forget_everything_leaves_nothing_to_repair() {
        let dir = tempfile::tempdir().unwrap();
        // 111 was moved away by a build that left it listed, 222 is listed and still staged, and
        // 333 is a folder the list no longer mentions.
        let cmd = staged(&dir.path().join("steamcmd"), &[111, 222], &[222, 333]);
        assert_eq!(cmd.forget_everything().unwrap(), vec![111, 222, 333]);
        let text = std::fs::read_to_string(cmd.acf_path()).unwrap();
        assert!(acf::listed_items(&text).is_empty());
        assert!(text.contains("\"appid\""), "only the items go; the rest of the file stays");
        assert_eq!(std::fs::read_dir(cmd.downloads_dir()).unwrap().count(), 0);
        assert!(cmd.forget_everything().unwrap().is_empty(), "a second sweep finds nothing");
    }

    /// Steam's copy of `id` in a library under `root`, holding `files`, plus the record Steam keeps.
    fn steam_copy(root: &Path, id: u64, files: &[&str]) -> PathBuf {
        let workshop = root.join("steamapps").join("workshop");
        let copy = workshop.join("content").join("294100").join(id.to_string());
        for f in files {
            let p = copy.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, "old").unwrap();
        }
        std::fs::write(workshop.join("appworkshop_294100.acf"), "Steam's own record").unwrap();
        copy
    }

    #[test]
    fn force_update_replaces_steams_copy_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let cmd = staged(&dir.path().join("steamcmd"), &[111], &[111]);
        let copy = steam_copy(&dir.path().join("Steam"), 111, &["About/About.xml", "Textures/Wall.dds"]);
        assert_eq!(cmd.replace_workshop_copy(111, &copy).unwrap(), copy);
        assert_eq!(std::fs::read_to_string(copy.join("About").join("About.xml")).unwrap(), "<ModMetaData/>");
        assert!(!copy.join("Textures").join("Wall.dds").exists(), "the whole folder is replaced");
        assert!(!copy.join("About").join("PublishedFileId.txt").exists(), "no PublishedFileId.txt is added to Steam's folder");
        let workshop = dir.path().join("Steam").join("steamapps").join("workshop");
        assert!(!workshop.join("circinus-replaced-111").exists(), "the old copy is gone once the new one is in");
        assert_eq!(std::fs::read_to_string(workshop.join("appworkshop_294100.acf")).unwrap(), "Steam's own record", "only Steam writes its record");
        assert!(acf::listed_items(&std::fs::read_to_string(cmd.acf_path()).unwrap()).is_empty(), "SteamCMD has nothing left to repair");
        assert!(!cmd.downloads_dir().join("111").exists());
    }

    #[test]
    fn force_update_leaves_a_mod_steam_is_downloading() {
        let dir = tempfile::tempdir().unwrap();
        let cmd = staged(&dir.path().join("steamcmd"), &[111], &[111]);
        let copy = steam_copy(&dir.path().join("Steam"), 111, &["About/About.xml"]);
        std::fs::create_dir_all(dir.path().join("Steam/steamapps/workshop/downloads/294100/111")).unwrap();
        assert!(cmd.replace_workshop_copy(111, &copy).is_err());
        assert_eq!(std::fs::read_to_string(copy.join("About").join("About.xml")).unwrap(), "old", "Steam's copy is untouched");
        // A folder that is not the item's is refused as well, before anything moves.
        let other = steam_copy(&dir.path().join("Other"), 222, &["About/About.xml"]);
        assert!(cmd.replace_workshop_copy(111, &other).is_err());
        assert_eq!(std::fs::read_to_string(other.join("About").join("About.xml")).unwrap(), "old");
    }

    #[test]
    fn a_download_goes_where_it_was_queued_for() {
        let ws = PathBuf::from("/lib/steamapps/workshop/content/294100");
        let mods = PathBuf::from("/game/Mods");
        let copy = ws.join("7");
        // A Force update of a Steam mod replaces Steam's copy, and needs no Mods folder to do it.
        assert_eq!(placement(Some(&copy), Some(&mods), Some(&ws)), Placement::SteamCopy(copy.clone()));
        assert_eq!(placement(Some(&copy), None, Some(&ws)), Placement::SteamCopy(copy.clone()));
        // Queued before a restart, but Circinus now reads another Workshop folder, or none: the
        // update is refused, and it does not become a copy in Mods either.
        assert!(matches!(placement(Some(&copy), Some(&mods), Some(Path::new("/other/steamapps/workshop/content/294100"))), Placement::Refused(_)));
        assert!(matches!(placement(Some(&copy), Some(&mods), None), Placement::Refused(_)));
        // A folder that only ends in the item's name, one level too deep, is not Steam's copy.
        assert!(matches!(placement(Some(&copy.join("7")), Some(&mods), Some(&ws)), Placement::Refused(_)));
        // Every other download goes to Mods, and needs a Mods folder to go to.
        assert_eq!(placement(None, Some(&mods), Some(&ws)), Placement::Mods(mods.clone()));
        assert!(matches!(placement(None, None, Some(&ws)), Placement::Refused(_)));
    }

    #[test]
    fn a_queued_request_says_where_its_download_goes() {
        let mut q = QueueState::default();
        let names = HashMap::new();
        let steam = |id: u64| HashMap::from([(id, format!("/lib/steamapps/workshop/content/294100/{id}"))]);
        assert_eq!(q.add_to(&[1], &steam(1), &names, 10), 1);
        assert_eq!(q.add(&[2], &names, 10), 1);
        assert_eq!(q.items[0].into_steam.as_deref(), Some("/lib/steamapps/workshop/content/294100/1"));
        assert_eq!(q.items[1].into_steam, None);
        // A plain request for an id still waiting must not turn its Force update into a copy in Mods.
        q.add(&[1], &names, 11);
        assert!(q.items[0].into_steam.is_some());
        // A finished id queued again goes wherever the new request says.
        q.items[0].status = ItemStatus::Done;
        q.add(&[1], &names, 12);
        assert_eq!(q.items[0].into_steam, None);
        // Once SteamCMD has an id, it goes where it was queued.
        q.items[1].status = ItemStatus::Downloading;
        q.add_to(&[2], &steam(2), &names, 13);
        assert_eq!(q.items[1].into_steam, None);
    }
}

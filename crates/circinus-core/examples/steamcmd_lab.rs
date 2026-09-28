//! Force update and SteamCMD's own record, run against the real SteamCMD in a scratch folder.
//!
//! The unit tests stage SteamCMD's folders by hand. This runs SteamCMD itself, because what
//! matters here is how SteamCMD behaves: a session re-downloads items its workshop ACF lists with
//! no files once a download needs a file from one of them, and a Force update of a Steam mod has
//! to leave the new version in Steam's folder with Steam's own record untouched.
//!
//! ```sh
//! cargo build -p circinus-core --example steamcmd_lab
//! HOME=<scratch>/home target/debug/examples/steamcmd_lab <scratch> <Steam's workshop/content/294100> [a b c d]
//! ```
//!
//! `HOME` has to be inside the scratch folder, and the lab refuses to start otherwise: on macOS,
//! SteamCMD writes its logs into the Steam client's folder under `HOME` even when its downloads go
//! somewhere else. Steam's own content folder is only read, to copy one mod out of. Four public
//! items are downloaded anonymously, a few times each: some tens of megabytes with the defaults.
//! The log excerpts are read from where macOS SteamCMD writes them; elsewhere the checks still
//! run and the excerpts are empty.
//!
//! 1. Control: the old `collect`, which moved an item out and left it listed. The next batch, which
//!    holds an item sharing a file with it, should trip over it; if it does not, the negative in
//!    run 2 proves nothing, and the lab says so.
//! 2. The fixed flow: `collect` takes the item off the list, and every batch starts from
//!    `forget_everything`. The next batch must leave the moved item alone.
//! 3. Force update into a copy of Steam's library: refused while Steam is staging the item, then
//!    the copy is replaced whole, Steam's record is untouched and nothing is left behind.

use circinus_core::steam::acf;
use circinus_core::steam::steamcmd::{self, ItemResult, Placement, SteamCmd, STALL_TIMEOUT};
use std::collections::BTreeSet;
use std::fmt::Display;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Public items. A is the one moved and watched, and B has to share a file with it. SteamCMD
/// builds a download out of identical chunks it already has on disk wherever it can, so B's job
/// reads A's copy of the shared file; with A moved away but still listed, that read fails with
/// "Missing game files", B fails, and SteamCMD validates everything it lists and downloads the
/// missing items again. An item listed with nothing on disk is otherwise left alone, which is why
/// a control built from unrelated items reproduces nothing. The defaults are Vanilla Expanded
/// Framework and Debug Assistance, which ship the same `System.Buffers.dll`: the pair that failed
/// on 2026-09-15. C and D are small and unrelated.
const DEFAULT_IDS: [u64; 4] = [2023507013, 3799021999, 2856471776, 3527418098];

fn err(e: impl Display) -> String {
    e.to_string()
}

#[derive(Default)]
struct Checks {
    failed: usize,
}

impl Checks {
    fn check(&mut self, ok: bool, what: &str) {
        println!("  {} {what}", if ok { "PASS" } else { "FAIL" });
        if !ok {
            self.failed += 1;
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (Some(scratch), Some(steam_content)) = (args.first(), args.get(1)) else {
        eprintln!("usage: HOME=<scratch>/home steamcmd_lab <scratch> <Steam's workshop/content/294100> [a b c d]");
        return ExitCode::from(2);
    };
    let (scratch, steam_content) = (PathBuf::from(scratch), PathBuf::from(steam_content));
    let ids: Vec<u64> = if args.len() > 2 { args[2..].iter().filter_map(|s| s.parse().ok()).collect() } else { DEFAULT_IDS.to_vec() };
    let [a, b, c, d] = ids[..] else {
        eprintln!("give four Workshop ids, or none for the defaults");
        return ExitCode::from(2);
    };
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from).filter(|h| h.starts_with(&scratch)) else {
        eprintln!("HOME has to be inside {}: SteamCMD writes its logs into the Steam client's folder under HOME, and this lab must not reach the real one", scratch.display());
        return ExitCode::from(2);
    };
    if scratch.starts_with(&steam_content) || steam_content.starts_with(&scratch) {
        eprintln!("the scratch folder and Steam's content folder must not contain one another");
        return ExitCode::from(2);
    }
    if !steam_content.join(a.to_string()).is_dir() {
        eprintln!("{a} is not in {}, and run 3 copies Steam's own copy of it", steam_content.display());
        return ExitCode::from(2);
    }
    match lab(&scratch, &steam_content, &home, [a, b, c, d]).await {
        Ok(0) => {
            println!("\nEvery check passed.");
            ExitCode::SUCCESS
        }
        Ok(n) => {
            println!("\n{n} check(s) failed.");
            ExitCode::from(1)
        }
        Err(e) => {
            eprintln!("\nThe lab could not finish: {e}");
            ExitCode::from(1)
        }
    }
}

async fn lab(scratch: &Path, steam_content: &Path, home: &Path, [a, b, c, d]: [u64; 4]) -> Result<usize, String> {
    let cmd = SteamCmd::new(scratch.join("steamcmd"));
    if !cmd.is_installed() {
        println!("Installing SteamCMD into {}", cmd.root.display());
        let client = reqwest::Client::builder().user_agent(circinus_core::weight::USER_AGENT).build().map_err(err)?;
        cmd.install(&client, &|line| println!("    {line}")).await.map_err(err)?;
    }
    let log = home.join("Library").join("Application Support").join("Steam").join("logs").join("workshop_log.txt");
    let mut checks = Checks::default();

    println!("\n1. Control: the old collect, which moved an item out and left it listed");
    cmd.forget_everything().map_err(err)?;
    let (ok, _) = batch(&cmd, &[a], &log).await?;
    checks.check(ok.contains(&a), &format!("SteamCMD downloaded {a}"));
    let old_mods = scratch.join("old-mods");
    let _ = std::fs::remove_dir_all(&old_mods);
    std::fs::create_dir_all(&old_mods).map_err(err)?;
    steamcmd::move_dir(&cmd.downloads_dir().join(a.to_string()), &old_mods.join(a.to_string())).map_err(err)?;
    checks.check(listed(&cmd).contains(&a), &format!("{a} is still on SteamCMD's list after the old move"));
    let (ok, lines) = batch(&cmd, &[b, c, d], &log).await?;
    let refetched = cmd.downloads_dir().join(a.to_string()).is_dir();
    let tripped = mentions(&lines, a);
    let reproduced = refetched || tripped;
    println!("  CONTROL SteamCMD {} {a} on its own, and its log {} it", if refetched { "downloaded" } else { "did not download" }, if tripped { "mentions" } else { "does not mention" });
    println!("  CONTROL {} of the 3 items asked for downloaded", ok.len());

    println!("\n2. The fixed flow: collect unlists, and every batch starts from forget_everything");
    let mods = scratch.join("Mods");
    let _ = std::fs::remove_dir_all(&mods);
    cmd.forget_everything().map_err(err)?;
    let (ok, _) = batch(&cmd, &[a], &log).await?;
    checks.check(ok.contains(&a), &format!("SteamCMD downloaded {a}"));
    let placed = cmd.collect(a, &mods).map_err(err)?;
    checks.check(placed == mods.join(a.to_string()) && placed.join("About").join("PublishedFileId.txt").is_file(), "collect put it in Mods with its id file");
    checks.check(!listed(&cmd).contains(&a), "collect took it off SteamCMD's list");
    cmd.forget_everything().map_err(err)?;
    let (ok, lines) = batch(&cmd, &[b, c, d], &log).await?;
    checks.check(ok.len() == 3, "the next batch downloaded all three it was asked for");
    let touched = cmd.downloads_dir().join(a.to_string()).is_dir() || mentions(&lines, a);
    if reproduced {
        checks.check(!touched, &format!("the next batch left {a} alone"));
    } else {
        println!("  SKIP the control did not reproduce the repair, so {a} being left alone here proves nothing");
    }

    println!("\n3. Force update into a copy of Steam's library");
    let workshop = scratch.join("library").join("steamapps").join("workshop");
    let content = workshop.join("content").join("294100");
    let target = content.join(a.to_string());
    let _ = std::fs::remove_dir_all(scratch.join("library"));
    circinus_core::fsx::copy_tree(&steam_content.join(a.to_string()), &target).map_err(|e| format!("could not copy Steam's copy of {a}: {e}"))?;
    std::fs::write(target.join("stale-copy.txt"), "written by the lab; a whole replacement removes it").map_err(err)?;
    let record = workshop.join("appworkshop_294100.acf");
    std::fs::write(&record, "the record Steam keeps").map_err(err)?;
    cmd.forget_everything().map_err(err)?;
    let (ok, _) = batch(&cmd, &[a], &log).await?;
    checks.check(ok.contains(&a), &format!("SteamCMD downloaded {a}"));
    checks.check(steamcmd::placement(Some(&target), Some(&mods), Some(&content)) == Placement::SteamCopy(target.clone()), "placement sends it to Steam's copy, not to Mods");
    let staging = workshop.join("downloads").join("294100").join(a.to_string());
    std::fs::create_dir_all(&staging).map_err(err)?;
    let refused = cmd.replace_workshop_copy(a, &target);
    if let Err(e) = &refused {
        println!("    ({e})");
    }
    checks.check(refused.is_err() && target.join("stale-copy.txt").is_file(), "refused while Steam is staging the item, and Steam's copy untouched");
    std::fs::remove_dir_all(workshop.join("downloads")).map_err(err)?;
    match cmd.replace_workshop_copy(a, &target) {
        Ok(p) => checks.check(p == target, "replaced Steam's copy"),
        Err(e) => checks.check(false, &format!("replaced Steam's copy ({e})")),
    }
    checks.check(!target.join("stale-copy.txt").exists(), "the copy was replaced whole");
    checks.check(target.join("About").join("About.xml").is_file(), "what replaced it is a mod");
    checks.check(std::fs::read_to_string(&record).ok().as_deref() == Some("the record Steam keeps"), "Steam's record untouched");
    checks.check(!workshop.join(format!("circinus-replaced-{a}")).exists(), "nothing left aside");
    checks.check(listed(&cmd).is_empty(), "SteamCMD lists nothing afterwards");
    checks.check(!cmd.downloads_dir().join(a.to_string()).exists(), "SteamCMD's content folder no longer holds it");
    let (ours, steams) = (files(&target), files(&steam_content.join(a.to_string())));
    println!("    {} files in the new copy; Steam's own copy has {}", ours.len(), steams.len());
    let only_steams: Vec<&String> = steams.difference(&ours).collect();
    if !only_steams.is_empty() {
        println!("    only in Steam's own copy (written there locally, or another version): {only_steams:?}");
    }
    let only_ours: Vec<&String> = ours.difference(&steams).collect();
    checks.check(only_ours.is_empty(), &format!("nothing in the new copy that Steam's own copy lacks{}", if only_ours.is_empty() { String::new() } else { format!(": {only_ours:?}") }));
    Ok(checks.failed)
}

/// Run one batch and print what SteamCMD's workshop log said during it. Returns the ids it
/// reports as downloaded, and the log lines, so a check can look for a moved item in them.
async fn batch(cmd: &SteamCmd, ids: &[u64], log: &Path) -> Result<(BTreeSet<u64>, Vec<String>), String> {
    let from = std::fs::metadata(log).map(|m| m.len() as usize).unwrap_or(0);
    let items: Vec<(u64, bool)> = ids.iter().map(|id| (*id, false)).collect();
    let out = cmd.run_batch(&items, STALL_TIMEOUT, &mut |_: &str| {}).await.map_err(err)?;
    let lines: Vec<String> = std::fs::read(log).map(|b| String::from_utf8_lossy(&b[from.min(b.len())..]).lines().map(str::to_string).collect()).unwrap_or_default();
    for l in lines.iter().filter(|l| ["Loaded workshop items", "workshop file validation", "Update canceled", "result :"].iter().any(|k| l.contains(k))) {
        println!("    | {}", l.trim());
    }
    let ok: BTreeSet<u64> = out.results.iter().filter(|(_, r)| matches!(r, ItemResult::Ok { .. })).map(|(id, _)| *id).collect();
    println!("    {} of {} downloaded in {} s", ok.len(), ids.len(), out.seconds);
    Ok((ok, lines))
}

/// SteamCMD's log naming an item that was not in the batch: a job reading its files, or
/// downloading it.
fn mentions(lines: &[String], id: u64) -> bool {
    let (path, item) = (format!("294100/{id}"), format!("item {id}"));
    lines.iter().any(|l| l.contains(&path) || l.contains(&item))
}

fn listed(cmd: &SteamCmd) -> Vec<u64> {
    std::fs::read_to_string(cmd.acf_path()).map(|t| acf::listed_items(&t)).unwrap_or_default()
}

/// Every file under `root`, as a path relative to it.
fn files(root: &Path) -> BTreeSet<String> {
    walkdir::WalkDir::new(root).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.path().strip_prefix(root).ok().map(|p| p.to_string_lossy().to_string())).collect()
}

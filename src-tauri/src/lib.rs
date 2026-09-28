pub mod commands;
pub mod defs;
pub mod diag;
pub mod downloads;
pub mod instances;
pub mod logs;
pub mod packs;
pub mod patches;
pub mod state;
pub mod subscribe;
pub mod textures;
pub mod updater;
pub mod watch;

use commands::{ScanProgress, Shared};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

fn progress_emitter(handle: AppHandle, phase: &'static str) -> impl Fn(usize, usize) + Sync {
    let last = AtomicU64::new(0);
    move |done: usize, total: usize| {
        // at most ~20 events per second, plus the final one
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        if done == total || t.saturating_sub(last.load(Ordering::Relaxed)) >= 50 {
            last.store(t, Ordering::Relaxed);
            let _ = handle.emit("scan-progress", ScanProgress { phase, done, total });
        }
    }
}

/// Phase 1 (under the lock, seconds): read About/ folders and ModsConfig.xml, publish the list.
/// Returns the mods whose folders still need walking.
pub fn scan_quick_phase(handle: &AppHandle, st: &Shared, full: bool) -> Result<Vec<circinus_core::ModInfo>, String> {
    let progress = progress_emitter(handle.clone(), "read");
    let result = {
        let mut app = st.lock().map_err(|_| "state lock poisoned".to_string())?;
        app.scan_quick(full, &progress)
    };
    match result {
        Ok(shallow) => {
            // The merged defs described the list as it was before this scan; drop them rather
            // than answer questions about mods that may have moved or gone.
            if let Some(d) = handle.try_state::<Arc<defs::Defs>>() {
                d.inner().forget();
            }
            let _ = handle.emit("state-changed", ());
            Ok(shallow)
        }
        Err(e) => {
            let _ = handle.emit("scan-error", e.to_string());
            Err(e.to_string())
        }
    }
}

/// Phase 2 (no lock while walking): inspect folder contents, merge, cache, publish again.
pub fn inspect_phase(handle: &AppHandle, st: &Shared, shallow: Vec<circinus_core::ModInfo>) {
    if shallow.is_empty() {
        return;
    }
    let started = std::time::Instant::now();
    let inspections = circinus_core::scan::inspect_mods(&shallow, &progress_emitter(handle.clone(), "inspect"));
    tracing::info!(mods = shallow.len(), ms = started.elapsed().as_millis() as u64, "inspect");
    let result = match st.lock() {
        Ok(mut app) => app.apply_inspections(inspections).map_err(|e| e.to_string()),
        Err(_) => Err("state lock poisoned".into()),
    };
    match result {
        Ok(_) => {
            let _ = handle.emit("state-changed", ());
        }
        Err(e) => {
            let _ = handle.emit("scan-error", e);
        }
    }
}

/// Both phases back to back (startup, watcher, downloads), then the texture re-check.
pub fn run_scan(handle: AppHandle, st: Shared, full: bool) {
    if let Ok(shallow) = scan_quick_phase(&handle, &st, full) {
        inspect_phase(&handle, &st, shallow);
        if let Some(tex) = handle.try_state::<Arc<textures::Textures>>() {
            tex.inner().after_scan();
        }
    }
}

/// First launch: most of the screen's work area, within sensible bounds, centred. Later
/// launches: where the window was, as long as that spot is still on a monitor.
fn place_window(w: &tauri::WebviewWindow, st: &Shared) {
    use tauri::{LogicalPosition, LogicalSize};
    let saved = st.lock().ok().and_then(|app| app.window_state());
    let monitors = w.available_monitors().unwrap_or_default();
    if let Some(s) = saved.filter(|s| s.width >= 900 && s.height >= 600) {
        let on_screen = monitors.iter().any(|m| {
            let sf = m.scale_factor();
            let area = m.work_area();
            let (mx, my) = (area.position.x as f64 / sf, area.position.y as f64 / sf);
            let (mw, mh) = (area.size.width as f64 / sf, area.size.height as f64 / sf);
            // Enough of the title bar inside the monitor to grab it.
            (s.x as f64 + 80.0) < mx + mw && (s.x as f64 + s.width as f64 - 80.0) > mx && s.y as f64 >= my - 8.0 && (s.y as f64) < my + mh - 40.0
        });
        if on_screen {
            let _ = w.set_size(LogicalSize::new(s.width as f64, s.height as f64));
            let _ = w.set_position(LogicalPosition::new(s.x as f64, s.y as f64));
            if s.maximized {
                let _ = w.maximize();
            }
            return;
        }
    }
    let Some(m) = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten()) else { return };
    let sf = m.scale_factor();
    let area = m.work_area();
    let (aw, ah) = (area.size.width as f64 / sf, area.size.height as f64 / sf);
    // Wide enough for the rail, the list with all its columns, and the inspector.
    let width = (aw * 0.88).clamp(1180.0, 1880.0).min(aw - 16.0);
    let height = (ah * 0.9).clamp(720.0, 1160.0).min(ah - 16.0);
    let _ = w.set_size(LogicalSize::new(width, height));
    let _ = w.center();
}

pub(crate) fn remember_window(w: &tauri::WebviewWindow, st: &Shared) {
    let Ok(sf) = w.scale_factor() else { return };
    let maximized = w.is_maximized().unwrap_or(false);
    if maximized {
        // Keep the last unmaximized geometry; only the flag changes.
        if let Ok(app) = st.lock() {
            let mut s = app.window_state().unwrap_or_default();
            s.maximized = true;
            if s.width == 0 {
                s.width = 1440;
                s.height = 900;
            }
            app.store_window_state(&s);
        }
        return;
    }
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) else { return };
    let state = state::WindowState { x: (pos.x as f64 / sf).round() as i32, y: (pos.y as f64 / sf).round() as i32, width: (size.width as f64 / sf).round() as u32, height: (size.height as f64 / sf).round() as u32, maximized: false };
    if let Ok(app) = st.lock() {
        app.store_window_state(&state);
    }
}

pub fn run() {
    // The log goes to a file in the app's own data folder. Logging to stdout is logging to
    // nowhere once the app is packaged, which is how a black screen came to be reported with
    // nothing to read; if the file cannot be opened, stdout is better than silence.
    let log = circinus_core::paths::app_data_dir();
    match diag::install(&log) {
        Some(p) => eprintln!("Circinus is logging to {}", p.display()),
        None => {
            tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive("circinus=info".parse().unwrap_or_default())).init();
            eprintln!("Circinus could not open a log file; logging to this console instead");
        }
    }

    let app = state::App::open().unwrap_or_else(|e| {
        eprintln!("Circinus could not open its data folder: {e}");
        std::process::exit(1);
    });
    let shared: Shared = Arc::new(Mutex::new(app));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(shared.clone())
        .setup(move |app| {
            // The download manager needs the app handle for events; created here.
            let dl = downloads::Downloads::start(app.handle().clone(), shared.clone());
            app.manage(dl);
            app.manage(textures::Textures::new(app.handle().clone(), shared.clone()));
            app.manage(defs::Defs::new(app.handle().clone(), shared.clone()));
            app.manage(patches::Patches::new(app.handle().clone(), shared.clone()));
            // The window: where it was last time, else a size that suits this screen.
            if let Some(w) = app.get_webview_window("main") {
                place_window(&w, &shared);
                let st = shared.clone();
                let win = w.clone();
                w.on_window_event(move |e| {
                    if matches!(e, tauri::WindowEvent::CloseRequested { .. }) {
                        remember_window(&win, &st);
                    }
                });
            }
            // First scan in the background so the window appears immediately.
            let handle = app.handle().clone();
            let st = shared.clone();
            tauri::async_runtime::spawn_blocking(move || run_scan(handle, st, false));
            // Then keep an eye on Steam and the game while we are open.
            watch::start(app.handle().clone(), shared.clone());
            // And, more slowly, keep followed modpacks current: what they hold, and what their
            // curators have said.
            packs::start(app.handle().clone(), shared.clone());
            // And, a few seconds in, ask circinus.sh whether there is a newer build.
            let up = updater::Updater::new(app.handle().clone(), shared.clone());
            up.start();
            app.manage(up);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::get_description,
            commands::rescan,
            commands::set_active,
            commands::activate,
            commands::deactivate,
            commands::halo,
            commands::validate,
            commands::halo_rules,
            commands::save_mods_config,
            commands::import_list,
            commands::apply_import,
            commands::update_settings,
            commands::autodetect_locations,
            commands::update_user,
            commands::update_databases,
            commands::refresh_weights,
            commands::refresh_local_weights,
            commands::get_files,
            commands::get_user_rules,
            commands::set_user_rules,
            commands::edit_user_rule,
            commands::app_data_dir,
            commands::downloads_state,
            commands::downloads_add,
            commands::downloads_update,
            commands::downloads_add_text,
            commands::downloads_remove,
            commands::downloads_retry_failed,
            commands::downloads_clear_finished,
            commands::downloads_pause,
            commands::downloads_add_missing,
            commands::steamcmd_install,
            commands::steamcmd_status,
            commands::steamcmd_test,
            subscribe::steam_client_status,
            subscribe::subscription_state,
            subscribe::missing_workshop_ids,
            subscribe::subscribe_items,
            subscribe::unsubscribe_items,
            commands::acknowledge_changes,
            commands::mark_new_seen,
            commands::set_incompatibility_hidden,
            commands::clear_hidden_warnings,
            commands::diagnostics,
            commands::log_from_the_window,
            commands::dds_state,
            commands::dds_overview,
            commands::dds_start,
            commands::dds_cancel,
            commands::dds_revert,
            commands::dds_audit,
            commands::dds_fix,
            commands::saved_lists,
            commands::restore_list,
            commands::save_named_list,
            commands::load_named_list,
            commands::delete_named_list,
            commands::rename_named_list,
            commands::detach_list,
            commands::delete_mod,
            commands::localize_mod,
            commands::collection_track,
            commands::collection_refresh,
            commands::collection_acknowledge,
            commands::collection_untrack,
            commands::open_folder,
            commands::announcements_refresh,
            commands::announcements_seen,
            commands::announcements_mute,
            commands::instances_list,
            commands::instance_current,
            commands::instance_create,
            commands::instance_duplicate,
            commands::instance_rename,
            commands::instance_update,
            commands::instance_delete,
            commands::instance_switch,
            commands::get_launch_info,
            commands::launch_game,
            commands::player_log_paths,
            commands::analyze_player_log,
            commands::import_collection,
            commands::import_rentry,
            commands::check_updates,
            updater::app_build,
            updater::update_check,
            updater::update_install,
            defs::defs_start,
            defs::defs_status,
            defs::defs_stop,
            defs::defs_query,
            defs::defs_def,
            patches::patches_start,
            patches::patches_status,
            patches::patches_stop,
            patches::patches_report,
            patches::patches_for_mod,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Circinus");
}

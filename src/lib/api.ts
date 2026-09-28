// Thin wrapper over Tauri's invoke, with a browser mock so the UI can run outside Tauri.

import type { AddResult, AuditReport, BuiltinRule, CollectionPreview, DdsReport, DefQuery, DefsState, DefTree, ImportPreview, Instance, Issue, ItemSubscription, LaunchInfo, LaunchSettings, Locations, LogAnalysis, LogFile, ModFiles, ModPatchDetail, ModTextures, PatchJob, PatchReport, QueueState, RentryPreview, RestoreResult, Rule, RulesFile, SavedList, Settings, Snapshot, SortResult, SteamClientStatus, SteamCmdStatus, SubscribeOutcome, TestOutcome, TexState, UpdateCheck, UserData } from "./types";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let invokeImpl: Invoke | null = null;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeImpl) {
    if (inTauri) {
      const core = await import("@tauri-apps/api/core");
      invokeImpl = core.invoke as Invoke;
    } else {
      const mock = await import("./mock");
      invokeImpl = mock.invoke as Invoke;
    }
  }
  return invokeImpl<T>(cmd, args);
}

export const api = {
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  description: (uid: string) => invoke<string>("get_description", { uid }),
  rescan: (full = false) => invoke<Snapshot>("rescan", { full }),
  setActive: (uids: string[]) => invoke<Snapshot>("set_active", { uids }),
  activate: (uids: string[], at?: number) => invoke<Snapshot>("activate", { uids, at: at ?? null }),
  deactivate: (uids: string[]) => invoke<Snapshot>("deactivate", { uids }),
  halo: (apply: boolean) => invoke<SortResult>("halo", { apply }),
  validate: () => invoke<Issue[]>("validate"),
  save: () => invoke<string>("save_mods_config"),
  importList: (path?: string, text?: string) => invoke<ImportPreview>("import_list", { path: path ?? null, text: text ?? null }),
  applyImport: (uids: string[], append: boolean) => invoke<Snapshot>("apply_import", { uids, append }),
  updateSettings: (settings: Settings) => invoke<Snapshot>("update_settings", { settings }),
  autodetect: () => invoke<Locations>("autodetect_locations"),
  updateUser: (user: UserData) => invoke<Snapshot>("update_user", { user }),
  updateDatabases: () => invoke<string[]>("update_databases"),
  refreshWeights: () => invoke<number>("refresh_weights"),
  refreshLocalWeights: () => invoke<number>("refresh_local_weights"),
  files: (uid: string) => invoke<ModFiles>("get_files", { uid }),
  userRules: () => invoke<RulesFile>("get_user_rules"),
  editUserRule: (rule: Rule, remove: boolean) => invoke<Snapshot>("edit_user_rule", { edit: { rule, remove } }),
  appDataDir: () => invoke<string>("app_data_dir"),
  // downloads
  downloadsState: () => invoke<QueueState>("downloads_state"),
  downloadsAdd: (ids: number[]) => invoke<AddResult>("downloads_add", { ids }),
  downloadsUpdate: (uids: string[]) => invoke<AddResult>("downloads_update", { uids }),
  downloadsAddText: (text: string) => invoke<AddResult>("downloads_add_text", { text }),
  downloadsRemove: (ids: number[]) => invoke<QueueState>("downloads_remove", { ids }),
  downloadsRetryFailed: () => invoke<number>("downloads_retry_failed"),
  downloadsClearFinished: () => invoke<QueueState>("downloads_clear_finished"),
  downloadsPause: (paused: boolean) => invoke<QueueState>("downloads_pause", { paused }),
  downloadsAddMissing: () => invoke<[AddResult, string[]]>("downloads_add_missing"),
  steamcmdInstall: () => invoke<void>("steamcmd_install"),
  steamcmdStatus: () => invoke<SteamCmdStatus>("steamcmd_status"),
  steamcmdTest: () => invoke<TestOutcome>("steamcmd_test"),
  // subscriptions, through the Steam client
  steamClientStatus: () => invoke<SteamClientStatus>("steam_client_status"),
  subscriptionState: (ids: number[]) => invoke<ItemSubscription[]>("subscription_state", { ids }),
  missingWorkshopIds: () => invoke<[number[], string[]]>("missing_workshop_ids"),
  subscribeItems: (ids: number[]) => invoke<SubscribeOutcome>("subscribe_items", { ids }),
  unsubscribeItems: (ids: number[]) => invoke<SubscribeOutcome>("unsubscribe_items", { ids }),
  acknowledgeChanges: () => invoke<Snapshot>("acknowledge_changes"),
  markNewSeen: () => invoke<Snapshot>("mark_new_seen"),
  setIncompatibilityHidden: (uid: string, otherUid: string, hidden: boolean) => invoke<Snapshot>("set_incompatibility_hidden", { uid, otherUid, hidden }),
  clearHiddenWarnings: () => invoke<[number, Snapshot]>("clear_hidden_warnings"),
  diagnostics: () => invoke<string>("diagnostics"),
  logFromTheWindow: (message: string, stack?: string) => invoke<void>("log_from_the_window", { message, stack }),
  // list history
  savedLists: () => invoke<SavedList[]>("saved_lists"),
  restoreList: (path: string, save: boolean) => invoke<RestoreResult>("restore_list", { path, save }),
  saveNamedList: (name: string) => invoke<Snapshot>("save_named_list", { name }),
  loadNamedList: (name: string) => invoke<RestoreResult>("load_named_list", { name }),
  deleteNamedList: (name: string) => invoke<Snapshot>("delete_named_list", { name }),
  renameNamedList: (from: string, to: string) => invoke<Snapshot>("rename_named_list", { from, to }),
  detachList: () => invoke<Snapshot>("detach_list"),
  deleteMod: (uid: string) => invoke<[Snapshot, string]>("delete_mod", { uid }),
  localizeMod: (uid: string) => invoke<[Snapshot, string]>("localize_mod", { uid }),
  collectionTrack: (text: string) => invoke<Snapshot>("collection_track", { text }),
  collectionRefresh: (id?: number) => invoke<Snapshot>("collection_refresh", { id: id ?? null }),
  collectionAcknowledge: (id: number) => invoke<Snapshot>("collection_acknowledge", { id }),
  collectionUntrack: (id: number) => invoke<Snapshot>("collection_untrack", { id }),
  announcementsRefresh: () => invoke<Snapshot>("announcements_refresh"),
  announcementsSeen: (pack: number, at: number) => invoke<Snapshot>("announcements_seen", { pack, at }),
  announcementsMute: (pack: number, muted: boolean) => invoke<Snapshot>("announcements_mute", { pack, muted }),
  // instances
  instances: () => invoke<Instance[]>("instances_list"),
  instanceCurrent: () => invoke<Instance>("instance_current"),
  instanceCreate: (name: string, fromCurrent: boolean) => invoke<Instance>("instance_create", { name, fromCurrent }),
  instanceDuplicate: (id: string, name?: string) => invoke<Instance>("instance_duplicate", { id, name: name ?? null }),
  instanceRename: (id: string, name: string) => invoke<Instance>("instance_rename", { id, name }),
  instanceUpdate: (id: string, locations: Locations, launch: LaunchSettings) => invoke<Instance>("instance_update", { id, locations, launch }),
  instanceDelete: (id: string) => invoke<string>("instance_delete", { id }),
  instanceSwitch: (id: string, discard: boolean) => invoke<Instance>("instance_switch", { id, discard }),
  // launching
  launchInfo: () => invoke<LaunchInfo>("get_launch_info"),
  launchGame: () => invoke<string>("launch_game"),
  // game log
  playerLogPaths: () => invoke<LogFile[]>("player_log_paths"),
  analyzePlayerLog: (path?: string) => invoke<LogAnalysis>("analyze_player_log", { path: path ?? null }),
  // textures
  ddsState: () => invoke<TexState>("dds_state"),
  ddsOverview: () => invoke<ModTextures[]>("dds_overview"),
  ddsStart: (uids: string[]) => invoke<void>("dds_start", { uids }),
  ddsCancel: () => invoke<void>("dds_cancel"),
  ddsRevert: (uids: string[]) => invoke<void>("dds_revert", { uids }),
  ddsAudit: (uids: string[]) => invoke<AuditReport>("dds_audit", { uids }),
  ddsFix: (targets: [string, string[]][]) => invoke<DdsReport>("dds_fix", { targets }),
  // the merged defs
  defsStart: () => invoke<void>("defs_start"),
  defsStatus: () => invoke<DefsState>("defs_status"),
  defsStop: () => invoke<void>("defs_stop"),
  defsQuery: (xpath: string, limit: number) => invoke<DefQuery>("defs_query", { xpath, limit }),
  defsDef: (defType: string, defName: string) => invoke<DefTree | null>("defs_def", { defType, defName }),
  // code patches
  patchesStart: () => invoke<void>("patches_start"),
  patchesStatus: () => invoke<PatchJob>("patches_status"),
  patchesStop: () => invoke<void>("patches_stop"),
  patchesReport: () => invoke<PatchReport | null>("patches_report"),
  patchesForMod: (uid: string) => invoke<ModPatchDetail | null>("patches_for_mod", { uid }),
  importCollection: (text: string) => invoke<CollectionPreview>("import_collection", { text }),
  importRentry: (url: string) => invoke<RentryPreview>("import_rentry", { url }),
  checkUpdates: () => invoke<number>("check_updates"),
  haloRules: () => invoke<BuiltinRule[]>("halo_rules"),
  // a newer Circinus, from circinus.sh
  updateCheck: () => invoke<UpdateCheck>("update_check"),
  updateInstall: () => invoke<void>("update_install")
};

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!inTauri) {
    // The mock has no event system of its own; it emits the few events the UI needs to
    // show a job's progress in the browser.
    const mock = await import("./mock");
    return mock.listen(event, handler as (payload: unknown) => void);
  }
  const ev = await import("@tauri-apps/api/event");
  const un = await ev.listen<T>(event, (e) => handler(e.payload));
  return un;
}

/** The version this build is, as tauri.conf.json says it. The mock is 0.1.0. */
/// What to print where a version goes.
///
/// A development build carries the placeholder version `main` keeps, not a released one, so the
/// number on its own is misleading -- it reads as an old release rather than as "this is the
/// branch". Saying which kind of build it is costs a few words and stops the question.
export async function appVersion(): Promise<string> {
  if (!inTauri) return "0.1.0";
  const b = await invoke<{ version: string; dev: boolean }>("app_build");
  return b.dev ? `${b.version} · development build` : b.version;
}

/** Open a folder itself, rather than the folder above it.
 *
 *  Goes through our own `open_folder` command, not the opener plugin's `openPath`. That one is
 *  scope-checked against the capability file, and a permission listed with no `allow` list has an
 *  empty scope -- it refuses every path on every machine. Rust also gets to check that the thing
 *  is a folder before handing it to the system, which the plugin call could not.
 *
 *  `revealPath` below is the other one, and the two are easy to swap by accident because both end
 *  up in a file manager. */
export async function openFolder(path: string) {
  if (!inTauri) return console.info("[circinus] open", path);
  await invoke<void>("open_folder", { path });
}

/** Open the folder that *contains* the thing, with the thing selected in it.
 *
 *  Right for a file — you asked about that file and want to see it among its neighbours — and
 *  wrong for a folder, where it leaves you one level above the folder you asked for. */
export async function revealPath(path: string) {
  if (!inTauri) return console.info("[circinus] reveal", path);
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.revealItemInDir(path);
}

export async function openUrl(url: string) {
  if (!inTauri) {
    window.open(url, "_blank");
    return;
  }
  const opener = await import("@tauri-apps/plugin-opener");
  try {
    await opener.openUrl(url);
  } catch (e) {
    console.error(`[circinus] could not open ${url}:`, e);
    throw e;
  }
}

export async function pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!inTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const r = await dialog.open({ multiple: false, directory: false, filters });
  return typeof r === "string" ? r : null;
}

export async function pickFolder(title?: string): Promise<string | null> {
  if (!inTauri) return null;
  const dialog = await import("@tauri-apps/plugin-dialog");
  const r = await dialog.open({ multiple: false, directory: true, title });
  return typeof r === "string" ? r : null;
}

export async function assetUrl(path: string): Promise<string> {
  if (!inTauri) return "";
  const core = await import("@tauri-apps/api/core");
  return core.convertFileSrc(path);
}

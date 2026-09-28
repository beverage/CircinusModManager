<script lang="ts">
  import { store } from "$lib/store.svelte";
  import { I } from "$lib/icons";
  import { formatBytes, type ItemStatus } from "$lib/types";
  import { openUrl, revealPath } from "$lib/api";

  const q = $derived(store.downloads);
  const st = $derived(store.steamcmd);
  const missing = $derived(store.snap?.missing ?? []);
  const updates = $derived(store.snap?.updates ?? []);
  let text = $state("");
  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const t = setInterval(() => (now = Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  });
  const cooldown = $derived(q?.throttle.cooldownUntil ? Math.max(0, q.throttle.cooldownUntil - now) : 0);
  const counts = $derived(store.queueCounts);
  const order: ItemStatus[] = ["downloading", "queued", "failed", "done", "cancelled"];
  const items = $derived([...(q?.items ?? [])].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.addedAt - b.addedAt));
  const statusLabel: Record<ItemStatus, string> = { queued: "Queued", downloading: "Downloading", done: "Done", failed: "Failed", cancelled: "Cancelled" };
  const levelText = $derived(!q ? "" : q.throttle.level === 0 ? "Calm" : q.throttle.level === 1 ? "Cautious" : q.throttle.level === 2 ? "Backing off" : "Steam is pushing back");
  const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  async function add() {
    if (!text.trim()) return;
    const r = await store.queueText(text);
    if (r) text = "";
  }
</script>

<main class="center">
  <div class="top">
    <section class="card cmd">
      <h3>SteamCMD <span class="aside">{q?.steamcmdInstalled ? "ready" : q?.installing ? "installing" : store.downloadsError ? "unavailable" : q ? "not installed" : "connecting…"}</span></h3>
      {#if store.downloadsError}
        <div class="row"><span class="st bad">{@html I.error}</span><span>The download manager did not answer: <span class="mono">{store.downloadsError}</span></span></div>
        <div class="ctl"><button class="btn sm" onclick={() => store.refreshDownloads()}>{@html I.refresh}Try again</button></div>
      {:else if q?.steamcmdInstalled}
        <div class="row"><span class="st ok">{@html I.check}</span><span>Installed. Downloads use an anonymous Steam login and land in your Mods folder as <span class="mono">&lt;workshop id&gt;</span> with a <span class="mono">PublishedFileId.txt</span>, so Circinus knows where they came from. A Force update of a Steam mod goes into Steam's own folder instead, in place of Steam's copy.</span></div>
        {#if st}
          <dl class="paths">
            <dt>Tool</dt><dd><button class="lnk mono" title="Show in your file manager" onclick={() => revealPath(st.exe)}>{st.exe}</button></dd>
            <dt>Console log</dt><dd title={st.consoleLog}><button class="lnk mono" title="Show in your file manager" onclick={() => revealPath(st.consoleLog)}>{st.consoleLogBytes ? `console_log.txt · ${formatBytes(st.consoleLogBytes)}` : "console_log.txt · not written yet"}</button></dd>
            <dt>Mods folder</dt><dd class="mono">{st.modsDir ?? "not set, choose it in Settings"}</dd>
          </dl>
        {/if}
        <div class="ctl">
          <button class="btn sm" disabled={q.running || q.installing} title="Runs +login anonymous +quit and shows the output below" onclick={() => store.testSteamCmd()}>{@html I.terminal}Test SteamCMD</button>
          <button class="btn sm" disabled={q.running || q.installing} title="Download SteamCMD again and let it update itself" onclick={() => store.installSteamCmd()}>{@html I.refresh}Reinstall</button>
          {#if st}<button class="btn sm" onclick={() => store.openFolder(st.root)}>{@html I.folder}Open folder</button>{/if}
        </div>
      {:else if q?.installing}
        <div class="row"><span class="spin"></span><span>Installing. SteamCMD downloads itself and updates on first run. The output appears below.</span></div>
      {:else}
        <div class="row"><span class="st warn">{@html I.warn}</span><span>Not installed. Valve's terms mean Circinus can't ship it, so it downloads it once (about 5 MB, then a self-update) into its own data folder. Needed to fetch Workshop mods without the Steam client, re-download broken ones, and pull whole collections.</span></div>
        <button class="btn primary" onclick={() => store.installSteamCmd()}>{@html I.download}Install SteamCMD</button>
      {/if}
    </section>

    <section class="card throttle">
      <h3>Smart throttle <span class="aside">{levelText}</span></h3>
      {#if q}
        <div class="meter-row">
          <span class="l">Batch size</span>
          <div class="meter" style="--c: var(--{q.throttle.level ? 'amber' : 'green'}); --v:{(q.throttle.batchSize / 25) * 100}%"><i></i></div>
          <span class="v num">{q.throttle.batchSize}<small>/25</small></span>
        </div>
        {#if cooldown > 0}
          <div class="cool"><span class="flag warning">{@html I.warn}</span>Steam is refusing downloads. Waiting <b class="num">{cooldown}s</b>, then trying a smaller batch.</div>
        {:else if q.throttle.last}
          <div class="last">Last batch: <b class="num">{q.throttle.last.succeeded}</b> ok, <b class="num">{q.throttle.last.failed + q.throttle.last.timedOut}</b> failed in {q.throttle.last.seconds}s{q.throttle.last.stalled ? " · stalled and was restarted" : ""}{q.throttle.last.authFailed ? " · login refused" : ""}</div>
        {:else}
          <div class="last">Batches start at 25 items, shrink when Steam refuses, grow again after two clean batches. Stalls are killed after 150 s; each item gets 4 tries, with validate after the first failure.</div>
        {/if}
        <div class="ctl">
          {#if q.paused}<button class="btn sm primary" onclick={() => store.pauseDownloads(false)}>{@html I.play}Resume</button>{:else}<button class="btn sm" onclick={() => store.pauseDownloads(true)}>Pause</button>{/if}
          <button class="btn sm" disabled={!counts.failed} onclick={() => store.retryFailed()}>Retry failed</button>
          <button class="btn sm" disabled={!counts.done} onclick={() => store.clearFinished()}>Clear done</button>
        </div>
      {/if}
    </section>
  </div>

  <section class="card add">
    <h3>Add downloads</h3>
    <div class="addrow">
      <input class="input" placeholder="Workshop link, collection link, workshop id, or paste a whole list" bind:value={text} onkeydown={(e) => e.key === "Enter" && add()} />
      <button class="btn primary" disabled={!text.trim()} onclick={add}>{@html I.download}Queue</button>
    </div>
    <div class="quick">
      {#if missing.length}
        <button class="btn sm" onclick={() => store.queueMissing()}>Download the {missing.length} mod{missing.length === 1 ? "" : "s"} in ModsConfig.xml that aren't installed</button>
      {/if}
      <button class="btn sm" onclick={() => store.checkUpdates()}>{@html I.refresh}Check Workshop for updates</button>
      {#if updates.length}
        <button class="btn sm" title="Steam mods are updated in Steam's folder, copies Circinus made in Mods" onclick={() => store.updateMods(updates.map((u) => u.uid))}>Update {updates.length} mod{updates.length === 1 ? "" : "s"}</button>
      {/if}
    </div>
  </section>

  {#if updates.length}
    <section class="card">
      <h3>Newer on the Workshop <span class="aside">checked {when(store.snap?.updatesCheckedAt ?? 0)}</span></h3>
      <div class="list">
        {#each updates.slice(0, 100) as u (u.uid)}
          <div class="it upd">
            <span class="nm"><b>{u.name}</b><span>on disk {when(u.localModified)} · Workshop {when(u.remoteUpdated)}{u.source === "workshop" ? " · goes into Steam's folder" : " · replaces your copy in Mods"}</span></span>
            <button class="btn sm" onclick={() => store.updateMods([u.uid])}>Update</button>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="card queue">
    <h3>Queue <span class="aside">{counts.queued} waiting · {counts.done} done · {counts.failed} failed</span></h3>
    {#if !items.length}
      <p class="hint">Nothing queued. Paste a Workshop or collection link above, or import a list and choose "Queue downloads".</p>
    {:else}
      <div class="list">
        {#each items as it (it.id)}
          <div class="it {it.status}" class:cur={q?.currentItem === it.id}>
            <span class="pill {it.status}">{#if it.status === "downloading"}<span class="spin sm"></span>{/if}{statusLabel[it.status]}</span>
            <span class="nm"><b>{it.name ?? `Workshop item ${it.id}`}</b><span class="mono">{it.id}{it.attempts ? ` · attempt ${it.attempts}` : ""}{it.error ? ` · ${it.error}` : ""}{it.bytes ? ` · ${formatBytes(it.bytes)}` : ""}</span></span>
            <span class="acts">
              <button class="ib" title="Workshop page" onclick={() => openUrl(`https://steamcommunity.com/sharedfiles/filedetails/?id=${it.id}`)}>{@html I.link}</button>
              {#if it.path}<button class="ib" title="Open folder" onclick={() => store.openFolder(it.path!)}>{@html I.folder}</button>{/if}
              <button class="ib" title="Remove" onclick={() => store.removeDownloads([it.id])}>{@html I.close}</button>
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if q?.log.length}
    <section class="card logcard">
      <h3>SteamCMD output</h3>
      <pre class="log">{q.log.slice(-40).join("\n")}</pre>
    </section>
  {/if}
</main>

<style>
  .center { display: flex; flex-direction: column; gap: 12px; min-height: 0; min-width: 0; overflow: hidden auto; padding-bottom: 14px; }
  .top { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .row { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: var(--text-2); line-height: 1.45; margin-bottom: 10px; }
  .st { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; flex: none; }
  .st :global(svg) { width: 11px; height: 11px; }
  .st.ok { background: var(--green-soft); color: var(--green); }
  .st.warn { background: var(--amber-soft); color: var(--amber); }
  .st.bad { background: var(--red-soft); color: var(--red); }
  .paths { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; font-size: 12px; margin: 0 0 10px; }
  .paths dt { color: var(--text-3); margin: 0; } .paths dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
  .paths .lnk { color: var(--blue); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
  .paths .lnk:hover { text-decoration: underline; }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--surface-4); border-top-color: var(--amber); animation: spin 0.8s linear infinite; flex: none; }
  .spin.sm { width: 10px; height: 10px; border-width: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .meter-row { display: grid; grid-template-columns: 80px 1fr auto; gap: 10px; align-items: center; font-size: 13px; }
  .meter-row .v { font-weight: 800; font-size: 16px; } .meter-row .v small { color: var(--text-3); font-weight: 600; font-size: 11px; }
  .cool { margin-top: 10px; background: var(--amber-soft); color: var(--amber); border-radius: 10px; padding: 8px 12px; font-size: 13px; display: flex; gap: 8px; align-items: center; }
  .last { margin-top: 10px; font-size: 12.5px; color: var(--text-3); line-height: 1.45; }
  .ctl { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .addrow { display: flex; gap: 8px; }
  .quick { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .hint { color: var(--text-3); font-size: 13px; margin: 0; }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .it { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 6px 8px; border-radius: 9px; }
  .it.upd { grid-template-columns: minmax(0, 1fr) auto; }
  .it:hover { background: var(--surface-2); }
  .it.cur { background: var(--surface-2); }
  .it.done { opacity: 0.7; }
  .nm { min-width: 0; display: flex; flex-direction: column; }
  .nm b { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm span { font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px; border-radius: 7px; font-size: 11.5px; font-weight: 700; min-width: 96px; justify-content: center; }
  .pill.queued { background: var(--surface-3); color: var(--text-2); }
  .pill.downloading { background: var(--blue-soft); color: #8fb8ff; }
  .pill.done { background: var(--green-soft); color: var(--green); }
  .pill.failed { background: var(--red-soft); color: var(--red); }
  .pill.cancelled { background: transparent; color: var(--text-4); box-shadow: inset 0 0 0 1px var(--surface-3); }
  .acts { display: flex; gap: 2px; opacity: 0; }
  .it:hover .acts { opacity: 1; }
  .ib { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--text-3); }
  .ib:hover { background: var(--surface-3); color: var(--text); }
  .ib :global(svg) { width: 14px; height: 14px; }
  .log { margin: 0; font-family: var(--mono); font-size: 11.5px; color: var(--text-2); line-height: 1.5; max-height: 260px; overflow: hidden auto; white-space: pre-wrap; user-select: text; }
  @media (max-width: 1100px) { .top { grid-template-columns: 1fr; } }
</style>

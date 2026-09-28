<script lang="ts">
  import { store } from "$lib/store.svelte";
  import { I, sevIcon } from "$lib/icons";
  import { describe, explainLoad } from "$lib/describe";
  import { api, assetUrl, openUrl } from "$lib/api";
  import { BAND_LABEL, describeChange, formatBytes, initials, LOAD_BAND_LABEL, PHASES, severityOf, SOURCE_LABEL, splitTarget, type Issue, type Phase, type Rule } from "$lib/types";

  const m = $derived(store.selectedMod);
  const placement = $derived(m ? store.placement(m.uid) : undefined);
  const issues = $derived(m ? store.issuesByUid.get(m.uid) ?? [] : []);
  const rules = $derived(m ? (store.rulesBySubject.get(m.packageId) ?? []).filter((r) => r.kind !== "incompatible" || true) : []);
  const delta = $derived(m ? store.moveOf.get(m.uid) : undefined);
  const weight = $derived(m ? store.weightOf(m) : undefined);
  const group = $derived(m ? store.groupOf(m.uid) : undefined);
  const isActive = $derived(m ? store.activeSet.has(m.uid) : false);
  const change = $derived(m ? store.changeByUid.get(m.uid) : undefined);
  const update = $derived(m ? store.updateByUid.get(m.uid) : undefined);
  /** Force update replaces a mod in the folder it is installed in, so only Steam mods and copies
   *  Circinus made get it. Other local folders are left alone. */
  const canRedownload = $derived(!!m?.publishedFileId && (m.source === "workshop" || m.source === "steamcmd"));
  const forceUpdateHint = $derived(
    m?.source === "workshop" ? "Downloads the current version with SteamCMD and puts it in Steam's folder, in place of Steam's copy" : "Downloads the current version with SteamCMD and puts it in place of your copy in Mods"
  );
  /** Steam can only unsubscribe from what it put there: a Workshop folder it still lists. */
  const canUnsubscribe = $derived(!!m?.publishedFileId && m.source === "workshop" && store.subscriptions[m.publishedFileId] !== "absent");
  let confirmUnsub = $state(false);
  $effect(() => {
    // A new mod in the panel starts with the confirmation closed, and Steam is asked what it
    // knows about this one so the actions match reality rather than the folder's name.
    const pfid = m?.publishedFileId;
    confirmUnsub = false;
    if (pfid) store.readSubscriptions([pfid]);
  });
  /** The Workshop id inside a dependency's link, when the About.xml gave one. */
  function depWorkshopId(i: Issue): number | null {
    if (i.kind !== "missingDependency" || i.installedUid) return null;
    const id = /[?&]id=(\d+)/.exec(i.workshopUrl ?? "")?.[1];
    return id ? Number(id) : null;
  }
  const dds = $derived(m ? store.ddsOf(m.uid) : undefined);
  const patches = $derived(m ? store.patchesOf(m.uid) : undefined);
  /** The methods this mod fights over, worst first: most patchers, then by name. */
  const patchFights = $derived.by(() => (m ? store.contestedFor(m.uid).slice(0, 3) : []));
  const ddsExcluded = $derived(m ? (store.snap?.user.ddsExcluded ?? []).includes(m.uid) : false);
  const GRAD: Record<Phase, [string, string]> = { core: ["#3b5fd9", "#1b2a5c"], prepatch: ["#8b6cf0", "#3a2a6e"], framework: ["#2ea59e", "#12403e"], content: ["#3fb865", "#173f24"], patch: ["#d9508f", "#5a1f3c"], texture: ["#e39b3a", "#5d3a0f"], late: ["#8fa3c7", "#2f3a4e"], optimization: ["#f07a4d", "#5d2a17"] };
  let preview = $state<string>("");
  let description = $state<string>("");
  $effect(() => {
    const p = m?.preview;
    preview = "";
    if (p) assetUrl(p).then((u) => (preview = u));
  });
  $effect(() => {
    const uid = m?.uid;
    description = "";
    if (uid) api.description(uid).then((d) => { if (m?.uid === uid) description = d; }).catch(() => {});
  });

  function ruleLine(r: Rule): { type: string; name: string; ok: boolean } {
    const mine = r.subject === m?.packageId;
    const otherId = mine ? r.target : r.subject;
    const other = otherId ? store.byPackage.get(otherId) : undefined;
    const name = other?.name ?? otherId ?? "";
    if (r.kind === "loadTop") return { type: "top", name: "Load at the top", ok: true };
    if (r.kind === "loadBottom") return { type: "bottom", name: "Load at the bottom", ok: true };
    if (r.kind === "incompatible") return { type: "never", name, ok: !(other && store.activeSet.has(other.uid)) };
    const after = (r.kind === "loadAfter") === mine; // from this mod's point of view
    if (r.comment === "Needs it") {
      const mi0 = m ? store.indexOf.get(m.uid) : undefined;
      const oi0 = other ? store.indexOf.get(other.uid) : undefined;
      const ok0 = mi0 == null || oi0 == null ? true : after ? mi0 > oi0 : mi0 < oi0;
      return { type: after ? "needs" : "needed by", name, ok: ok0 };
    }
    const mi = m ? store.indexOf.get(m.uid) : undefined;
    const oi = other ? store.indexOf.get(other.uid) : undefined;
    const ok = mi == null || oi == null ? true : after ? mi > oi : mi < oi;
    return { type: after ? "after" : "before", name, ok };
  }
  const srcLabel: Record<string, string> = { about: "About", community: "Community", user: "Mine", halo: "HALO" };
  function workshopUrl() {
    return m?.publishedFileId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${m.publishedFileId}` : m?.url;
  }
  let newGroup = $state(false);
  let newGroupName = $state("");
  let newGroupInput = $state<HTMLInputElement | null>(null);
  function onGroupChoice(value: string) {
    if (!m) return;
    if (value === "+new") {
      newGroup = true;
      setTimeout(() => newGroupInput?.focus(), 0);
      return;
    }
    store.setGroup(store.selected.length > 1 ? store.selected : [m.uid], value || null);
  }
  function makeGroup() {
    if (!m || !newGroupName.trim()) return;
    store.addGroup(newGroupName, { members: store.selected.length > 1 ? store.selected : [m.uid] });
    newGroupName = "";
    newGroup = false;
  }
  const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  /** The last two parts of a path; the whole thing is in the tooltip. */
  function shortPath(p: string) {
    const parts = p.split(/[\\/]/).filter(Boolean);
    const sep = p.includes("\\") ? "\\" : "/";
    return parts.length > 2 ? "…" + sep + parts.slice(-2).join(sep) : p;
  }
</script>

<aside class="inspector">
  {#if m}
    <section class="card">
      <div class="hero">
        {#if preview}
          <img class="thumb" src={preview} alt="" />
        {:else}
          {@const [c1, c2] = GRAD[placement?.phase ?? "content"]}
          <span class="thumb mono-tile" style="--c1:{c1};--c2:{c2}">{initials(m.name)}</span>
        {/if}
        <div class="t"><b>{m.name}</b><span>{m.authors.join(", ") || "Unknown author"}</span><span class="mono">{m.packageId || "no packageId"}</span></div>
      </div>
      <dl class="kv">
        <dt>Source</dt><dd>{SOURCE_LABEL[m.source]}{#if m.publishedFileId} · <button class="lnk mono" onclick={() => openUrl(workshopUrl()!)}>{m.publishedFileId}</button>{/if}</dd>
        <dt>Game versions</dt><dd>{m.supportedVersions.join(", ") || "none listed"}{m.modVersion ? ` · mod v${m.modVersion}` : ""}</dd>
        <dt>Size</dt><dd class="num">{formatBytes(m.contents.sizeBytes)}</dd>
        <dt>Contains</dt><dd>{[m.contents.assemblies ? `${m.contents.assemblies} code file${m.contents.assemblies === 1 ? "" : "s"}` : null, m.contents.defs ? `${m.contents.defs} def files` : null, m.contents.patches ? `${m.contents.patches} patch files` : null, m.contents.textures + m.contents.dds ? `${(m.contents.textures + m.contents.dds).toLocaleString()} textures` : null].filter(Boolean).join(", ") || "nothing the game loads"}</dd>
        <dt>Last changed</dt><dd>{m.modified ? new Date(m.modified * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "unknown"}</dd>
        <dt>Folder</dt><dd class="fld" title={m.linkTarget ? `${m.path}\nis a link to\n${m.linkTarget}` : m.path}><span class="mono">{folderName(m.path)}</span>{#if m.linkTarget}<span class="lt">a link to <span class="mono">{shortPath(m.linkTarget)}</span></span>{/if}</dd>
        {#if m.contents.textures + m.contents.dds > 0 || dds}
          <dt>Textures</dt>
          <dd>{m.contents.textures.toLocaleString()} PNG{m.contents.dds ? ` · ${m.contents.dds.toLocaleString()} DDS` : ""}{dds ? ` (${dds.count.toLocaleString()} by Circinus, ${formatBytes(dds.ddsBytes)})` : ""}{ddsExcluded ? " · excluded" : ""}</dd>
        {/if}
        <dt>Group</dt>
        <dd>
          <select class="sel" value={group?.id ?? ""} onchange={(e) => onGroupChoice((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">None</option>
            {#each store.snap?.user.groups ?? [] as g}<option value={g.id}>{g.name}{g.section && g.phase ? " (own section)" : g.phase ? ` (sorted as ${store.phaseInfo(g.phase).name.toLowerCase()})` : ""}</option>{/each}
            <option value="+new">New group…</option>
          </select>
          {#if newGroup}
            <form class="newg" onsubmit={(e) => { e.preventDefault(); makeGroup(); }}>
              <input class="input" placeholder="Group name" bind:value={newGroupName} bind:this={newGroupInput} />
              <button class="btn sm primary" type="submit">Add</button>
              <button class="btn sm" type="button" onclick={() => (newGroup = false)}>Cancel</button>
            </form>
          {/if}
        </dd>
      </dl>
    </section>

    {#if change || update}
      <section class="card changed">
        <h3>{change ? "Changed since last launch" : "Newer on the Workshop"}</h3>
        {#if change}<div class="chg"><span class="flag chg">{@html change.kind === "added" ? I.plus : I.change}</span><span>{describeChange(change)}</span></div>{/if}
        {#if update}<div class="chg"><span class="flag note">{@html I.up}</span><span>Workshop version from {new Date(update.remoteUpdated * 1000).toLocaleDateString()}; yours is from {new Date(update.localModified * 1000).toLocaleDateString()}.{update.source === "workshop" ? " Force update puts the new version in Steam's folder." : " Force update replaces your copy in Mods."}</span></div>{/if}
        <div class="acts two">
          {#if m.publishedFileId}<button class="btn" onclick={() => openUrl(`https://steamcommunity.com/sharedfiles/filedetails/changelog/${m.publishedFileId}`)}>Changelog</button>{/if}
          {#if canRedownload}<button class="btn" title={forceUpdateHint} onclick={() => store.updateMods([m.uid])}>{@html I.download}Force update</button>{/if}
        </div>
      </section>
    {/if}

    <section class="card halo">
      <h3>Where HALO puts it</h3>
      {#if placement}
        <div class="ph2"><span class="dot c-{store.phaseInfo(placement.phase).color}"></span><b>{store.phaseInfo(placement.phase).name}</b></div>
        <div class="why">{placement.reason}</div>
      {:else}
        <div class="ph2">Not in the active list</div>
      {/if}
      <div class="move">
        {#if delta}
          HALO would move it <b>{Math.abs(delta)} row{Math.abs(delta) === 1 ? "" : "s"} {delta > 0 ? "down" : "up"}</b>.
        {:else if store.preview}
          Already where HALO would put it.
        {:else}
          Press <b>Sort with HALO</b> to see where it would go.
        {/if}
      </div>
      <div class="ctl">
        <label class="switch"><input type="checkbox" checked={store.pinned.has(m.uid)} onchange={() => store.togglePin(m.uid)} />Keep its position when sorting</label>
        <label class="fld"><span>Sort it as</span>
          <select class="sel" value={store.sortAsOf(m.uid)} onchange={(e) => store.setSortAs(store.selected.length > 1 ? store.selected : [m.uid], (e.currentTarget as HTMLSelectElement).value)}>
            <option value="">Let HALO decide</option>
            {#each PHASES as p}
              <option value={p.id}>{p.name}</option>
              {#each store.sectionGroups.filter((g) => g.phase === p.id) as g}<option value="group:{g.id}">{g.name} (your group, after {p.name.toLowerCase()})</option>{/each}
            {/each}
          </select>
        </label>
        <p class="hint">A group of yours can have its own place in the order: give it one under Groups, in the panel on the left, and it appears here.</p>
      </div>
    </section>

    {#if store.showWeight}
      <section class="card">
        <h3>Performance cost <span class="aside">{weight?.origin === "local" ? "from your runs" : weight ? "from circinus.sh" : ""}</span></h3>
        {#if weight}
          <dl class="kv wkv">
            <dt>Share of frame time</dt><dd class="num"><b>{weight.share != null ? `${weight.share.toFixed(2)} %` : "under 0.01 %"}</b> <span class="band {weight.band}">{BAND_LABEL[weight.band]}</span></dd>
            {#if weight.measured != null}<dt>Runs measured</dt><dd class="num">{weight.measured.toLocaleString()}</dd>{/if}
            {#if weight.installs != null}<dt>Players measured</dt><dd class="num">{weight.installs.toLocaleString()}</dd>{/if}
            <dt>Ranked</dt><dd>{weight.ranked ? "yes" : "not yet: needs 25 runs from 10 players"}</dd>
            {#if weight.netLow != null && weight.netHigh != null}<dt>Net cost</dt><dd class="num">{weight.netLow.toFixed(2)} to {weight.netHigh.toFixed(2)} %</dd>{/if}
            {#if weight.withheld}<dt>Note</dt><dd>The author asked for figures to be hidden</dd>{/if}
          </dl>
          <button class="lnk" onclick={() => openUrl(`https://circinus.sh/mods/${encodeURIComponent(m.packageId)}`)}>Open on circinus.sh</button>
        {:else}
          <div class="wmeta">No figures for this mod yet. A mod gets a figure after 25 clean runs from 10 players.</div>
        {/if}
      </section>
    {/if}

    {#if m.contents.load}
      {@const ld = store.loadOf(m.uid)}
      <section class="card">
        <h3>Loading time <span class="aside">estimated from the folder</span></h3>
        <dl class="kv wkv">
          {#if ld && store.activeSet.has(m.uid)}
            <dt>Share of the list</dt><dd class="num"><b>{ld.share >= 0.0005 ? `${(ld.share * 100).toFixed(ld.share < 0.01 ? 2 : 1)} %` : "under 0.05 %"}</b> <span class="band {ld.band}">{LOAD_BAND_LABEL[ld.band]}</span></dd>
            <dt>About</dt><dd class="num">{ld.ms >= 1000 ? `${(ld.ms / 1000).toFixed(1)} s` : `${ld.ms} ms`} of an estimated {store.loadTotalSeconds >= 60 ? `${(store.loadTotalSeconds / 60).toFixed(1)} min` : `${store.loadTotalSeconds.toFixed(0)} s`}</dd>
          {:else}
            <dt>About</dt><dd class="num">{m.contents.load.scoreMs >= 1000 ? `${(m.contents.load.scoreMs / 1000).toFixed(1)} s` : `${m.contents.load.scoreMs} ms`} if it were active</dd>
          {/if}
          <dt>From</dt><dd>{explainLoad(m).join(" · ") || "nothing that costs time"}</dd>
        </dl>
        <div class="wmeta">A ranking, not a stopwatch: Defs XML, patch operations (those that search the whole document cost far more), PNG textures without DDS, assemblies. Converting textures to DDS takes most of the texture part away.</div>
      </section>
    {/if}

    {#if patches}
      <section class="card patches">
        <h3>Patches <span class="aside">{patches.harmonyIds[0] ?? "no Harmony id"}</span></h3>
        <dl class="kv wkv">
          <dt>Methods patched</dt><dd class="num"><b>{patches.patches.toLocaleString()}</b> in {patches.assemblies} assembl{patches.assemblies === 1 ? "y" : "ies"}</dd>
          <dt>Before / after / rewrites</dt><dd class="num">{patches.prefixes} · {patches.postfixes} · {patches.transpilers}</dd>
          {#if patches.manual}<dt>Cannot be read</dt><dd>{patches.manual} place{patches.manual === 1 ? "" : "s"} where it works out the target as it runs</dd>{/if}
          {#if patches.harmonyIds.length > 1}<dt>Harmony ids</dt><dd class="mono">{patches.harmonyIds.join(", ")}</dd>{/if}
        </dl>
        {#if patchFights.length}
          <div class="fights">
            <div class="fh">Shares these methods with another mod that changes them too:</div>
            {#each patchFights as t}
              {@const others = t.patchers.filter((p) => p.uid !== m.uid)}
              <button class="fr" onclick={() => (store.view = "patches")} title="Open the Patches view">
                <span class="mono">{splitTarget(t.target)[1]}</span>
                <span class="ow">with {others.map((p) => p.modName).filter((n, i, a) => a.indexOf(n) === i).join(", ")}</span>
              </button>
            {/each}
          </div>
        {:else}
          <div class="muted">No method it patches is changed by another mod.</div>
        {/if}
      </section>
    {/if}

    <section class="card">
      <h3>Load order rules <span class="aside">{rules.filter((r) => ruleLine(r).ok).length} of {rules.length} met</span></h3>
      {#if rules.length}
        <div class="rules">
          {#each rules as r}
            {@const l = ruleLine(r)}
            <div class="rule" title={r.comment ?? ""}>
              <span class="st" class:ok={l.ok} class:bad={!l.ok}>{@html l.ok ? I.check : I.error}</span>
              <span class="ty">{l.type}</span>
              <span class="nm">{l.name}</span>
              <span class="srcb {r.source}">{srcLabel[r.source]}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="muted">No load order rules mention this mod.</div>
      {/if}
    </section>

    {#if issues.length}
      <section class="card issues">
        <h3>Needs attention</h3>
        {#each issues.slice(0, 12) as i}
          {@const dep = depWorkshopId(i)}
          <div class="it">
            <span class="flag {severityOf(i)}">{@html sevIcon[severityOf(i)]}</span>
            <span>{describe(i, store.byUid, m.uid)}
              {#if dep}<button class="lnk sub" title="Opens that mod's page in Steam, where Subscribe is one press" onclick={() => store.subscribeIds([dep])}>Subscribe in Steam</button>{/if}
              {#if i.kind === "incompatible"}
                <!-- The databases are a community's best guess, and a patch can make two mods
                     work together without anybody updating the entry. A warning that cannot be
                     dismissed is one a player learns to look past, along with the true ones. -->
                <button class="lnk sub" title="Stop showing this one. Settings brings every hidden warning back." onclick={() => store.setIncompatibilityHidden(i.uid, i.otherUid, true)}>Hide this warning</button>
              {/if}
            </span>
          </div>
        {/each}
        {#if issues.length > 12}<div class="muted">and {issues.length - 12} more, see the Analyzer</div>{/if}
      </section>
    {/if}

    <section class="card">
      <h3>Actions</h3>
      <div class="acts">
        <button class="btn" title={m.linkTarget ? "Opens the folder the link points at, where the files are" : "Opens the mod's own folder in your file manager"} onclick={() => store.openFolder(m.linkTarget ?? m.path)}>{@html I.folder}Open folder</button>
        <button class="btn" disabled={!workshopUrl()} onclick={() => openUrl(workshopUrl()!)}>Workshop page</button>
        {#if canRedownload && !change && !update}<button class="btn" title={forceUpdateHint} onclick={() => store.updateMods([m.uid])}>{@html I.download}Force update</button>{/if}
        {#if m.contents.textures > 0 && !ddsExcluded && m.source !== "ludeon"}<button class="btn" title="Convert this mod's PNG textures to DDS" disabled={store.tex?.running} onclick={() => store.optimizeTextures([m.uid])}>{@html I.image}Make DDS</button>{/if}
        {#if dds}<button class="btn" title="Delete the DDS files Circinus made for this mod" disabled={store.tex?.running} onclick={() => store.revertTextures([m.uid])}>Remove DDS</button>{/if}
        {#if canUnsubscribe}
          {#if confirmUnsub}
            <button class="btn danger" onclick={() => { confirmUnsub = false; store.unsubscribeIds([m.publishedFileId!]); }}>Yes, unsubscribe</button>
            <button class="btn" onclick={() => (confirmUnsub = false)}>Keep it</button>
          {:else}
            <button class="btn danger" title="Opens the mod's page in Steam, where Unsubscribe is one press" onclick={() => (confirmUnsub = true)}>{@html I.minus}Unsubscribe</button>
          {/if}
        {/if}
        {#if isActive}
          <button class="btn" onclick={() => store.moveSelected(-1)}>Move up</button>
          <button class="btn" onclick={() => store.moveSelected(1)}>Move down</button>
          <button class="btn danger" onclick={() => store.deactivate(store.selected.length > 1 ? store.selected : [m.uid])}>Deactivate</button>
        {:else}
          <button class="btn primary" onclick={() => store.activate(store.selected.length > 1 ? store.selected : [m.uid])}>{@html I.plus}Activate</button>
        {/if}
      </div>
      {#if confirmUnsub}<p class="warnline">Steam deletes this mod's folder when you unsubscribe. Circinus cannot undo that; subscribing again downloads it afresh.</p>{/if}
      {#if description}<details class="desc"><summary>Description</summary><p>{description.replace(/<[^>]+>/g, "")}</p></details>{/if}
    </section>
  {:else}
    <section class="card empty-card">
      <div class="label">Mod details</div>
      <p>Click a mod to see its rules, where HALO puts it, and what needs attention.</p>
      <p>Shift-click selects a range. Ctrl-click adds to the selection. Alt + Up or Down moves the selection. Delete deactivates it.</p>
    </section>
  {/if}
</aside>

<style>
  .inspector { display: flex; flex-direction: column; gap: 12px; min-height: 0; min-width: 0; overflow: hidden auto; }
  .inspector .card { flex: none; min-width: 0; }
  .hero { display: flex; gap: 12px; align-items: flex-start; }
  .thumb { width: 64px; height: 64px; border-radius: 12px; flex: none; object-fit: cover; box-shadow: var(--shadow-card); }
  .mono-tile { display: grid; place-items: center; font: 800 18px var(--font); color: #fff; letter-spacing: -0.02em; background: linear-gradient(150deg, var(--c1), var(--c2)); }
  .hero .t { min-width: 0; }
  .hero .t b { display: block; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.15; }
  .hero .t span { display: block; color: var(--text-2); font-size: 12.5px; margin-top: 2px; }
  .hero .t .mono { margin-top: 6px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 12.5px; margin: 12px 0 0; }
  .kv dt { color: var(--text-3); margin: 0; white-space: nowrap; } .kv dd { margin: 0; text-align: right; color: var(--text-2); min-width: 0; overflow-wrap: anywhere; }
  .kv dd.fld .lt { display: block; color: var(--text-3); font-size: 11.5px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wkv { margin-top: 0; }
  .wkv b { color: var(--text); font-size: 14px; }
  .wkv .band { margin-left: 6px; vertical-align: middle; }
  .lnk { color: var(--blue); font-weight: 600; }
  .lnk:hover { text-decoration: underline; }
  .sel { height: 28px; border: 0; border-radius: 7px; background: var(--surface-3); color: var(--text); font-size: 12.5px; padding: 0 8px; max-width: 100%; min-width: 0; width: 100%; }
  .kv .sel { width: auto; max-width: 180px; }
  .newg { display: flex; gap: 6px; margin-top: 6px; justify-content: flex-end; }
  .newg .input { height: 28px; font-size: 12.5px; min-width: 0; flex: 1; }
  .halo .hint { color: var(--text-3); font-size: 11.5px; line-height: 1.4; margin: 6px 0 0; }
  .halo .ph2 { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .halo .why { color: var(--text-3); font-size: 12px; margin-top: 4px; line-height: 1.4; }
  .halo .move { margin-top: 10px; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; font-size: 12.5px; color: var(--text-2); }
  .halo .move b { color: var(--text); }
  .ctl { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; font-size: 12.5px; }
  .ctl .switch { font-size: 12.5px; }
  .ctl .fld { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-2); font-weight: 600; }
  .wmeta { font-size: 12px; color: var(--text-3); margin: 8px 0; line-height: 1.5; }
  .rules { display: flex; flex-direction: column; gap: 2px; }
  .rule { display: grid; grid-template-columns: 16px 62px minmax(0, 1fr) auto; gap: 7px; align-items: center; height: 30px; padding: 0 6px; border-radius: 8px; font-size: 12.5px; }
  .rule:hover { background: var(--surface-2); }
  .st { width: 16px; height: 16px; display: grid; place-items: center; }
  .st :global(svg) { width: 15px; height: 15px; }
  .ty { font: 600 10.5px var(--mono); color: var(--text-3); text-transform: uppercase; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .srcb { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 5px; background: var(--surface-3); color: var(--text-3); }
  .srcb.community { color: var(--teal); } .srcb.user { color: var(--violet); } .srcb.halo { color: var(--amber); }
  .issues .it { display: flex; gap: 10px; padding: 8px 0; font-size: 12.5px; color: var(--text-2); line-height: 1.4; }
  .issues .it + .it { border-top: 1px solid rgba(255, 255, 255, 0.05); }
  .issues .flag { margin-top: 1px; }
  .changed .chg { display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; color: var(--text-2); line-height: 1.45; padding: 4px 0; }
  .changed .chg .flag { margin-top: 2px; }
  .changed :global(.flag.chg) { background: var(--amber-soft); color: var(--amber); }
  .changed .acts { margin-top: 8px; }
  .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .acts .btn { height: 32px; font-size: 12.5px; background: var(--surface-2); }
  .acts .btn.primary { background: var(--amber); }
  .desc { margin-top: 12px; font-size: 12.5px; color: var(--text-2); }
  .desc summary { cursor: pointer; font-weight: 600; color: var(--text-3); }
  .desc p { white-space: pre-wrap; line-height: 1.5; max-height: 260px; overflow: hidden auto; margin: 8px 0 0; user-select: text; }
  .warnline { margin: 10px 0 0; font-size: 12px; color: var(--text-2); line-height: 1.45; }
  .lnk.sub { font-size: 12px; margin-left: 4px; white-space: nowrap; }
  .muted { color: var(--text-3); font-size: 12.5px; }
  .patches .kv dd.mono { font-size: 11.5px; }
  .patches .fights { margin-top: 10px; display: flex; flex-direction: column; gap: 2px; }
  .patches .fh { color: var(--text-3); font-size: 11.5px; line-height: 1.4; margin-bottom: 4px; }
  .patches .fr { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%; text-align: left; padding: 5px 7px; border-radius: 8px; }
  .patches .fr:hover { background: var(--surface-2); }
  .patches .fr .mono { font-size: 12px; color: var(--amber); font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .patches .fr .ow { font-size: 11.5px; color: var(--text-3); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty-card p { color: var(--text-3); font-size: 13px; line-height: 1.5; margin: 8px 0 0; }
</style>

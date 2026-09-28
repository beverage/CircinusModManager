<script lang="ts">
  import { store } from "$lib/store.svelte";
  import { I } from "$lib/icons";
  import { openUrl } from "$lib/api";
  import { SOURCE_LABEL, describeChange, type ChangeKind, type ModChange } from "$lib/types";

  /** Each change goes under one heading: what happened to it, not just that something did. */
  type Bucket = "workshop" | "version" | "renamed" | "files" | "added" | "removed";
  function bucket(c: ModChange): Bucket {
    if (c.kind === "added") return "added";
    if (c.kind === "removed") return "removed";
    if (c.reasons.includes("workshopUpdate")) return "workshop";
    if (c.reasons.includes("versionChange")) return "version";
    if (c.reasons.includes("renamed") || c.reasons.includes("sourceChanged")) return "renamed";
    return "files";
  }
  const groups = $derived.by(() => {
    const order: { id: Bucket; kind: ChangeKind; title: string; hint: string }[] = [
      { id: "workshop", kind: "updated", title: "Updated on the Workshop", hint: "Steam installed a newer version of these" },
      { id: "version", kind: "updated", title: "New version on disk", hint: "The version in About.xml changed without a Workshop update: a manual copy, SteamCMD, or a local build" },
      { id: "files", kind: "updated", title: "Files changed", hint: "Newer files inside the folder, same version: edited by hand, patched, or DDS textures added or removed" },
      { id: "renamed", kind: "updated", title: "Renamed or moved", hint: "The name in About.xml changed, or the mod now comes from a different place" },
      { id: "added", kind: "added", title: "New", hint: "Folders that were not there before" },
      { id: "removed", kind: "removed", title: "Removed", hint: "Folders that are gone; mods still in your list show as missing" }
    ];
    return order.map((g) => ({ ...g, items: store.changes.filter((c) => bucket(c) === g.id) })).filter((g) => g.items.length);
  });
  const list = $derived(store.listChange);
  const moves = $derived(list?.moves ?? []);
  const since = $derived.by(() => {
    const t = store.snap?.changesSince ?? 0;
    return t ? new Date(t * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  });
  const nameOf = (pkg: string) => store.byPackage.get(pkg.replace(/_steam$/, ""))?.name ?? pkg;

  // Escape closes the topmost thing; the store keeps the order. Import and Collection
  // had no Escape at all before this.
  $effect(() => store.onEscape("changes", 30, () => store.showChanges, close));

  function close() {
    store.showChanges = false;
  }
  function show(c: ModChange) {
    if (!store.byUid.has(c.uid)) return;
    close();
    store.view = "order";
    if (!store.activeSet.has(c.uid)) store.tab = "all";
    store.scrollTo(c.uid);
  }
  function changelog(c: ModChange) {
    if (c.publishedFileId) openUrl(`https://steamcommunity.com/sharedfiles/filedetails/changelog/${c.publishedFileId}`);
  }
  const redownloadable = $derived(store.changes.filter((c) => c.kind !== "removed" && c.publishedFileId && (c.source === "workshop" || c.source === "steamcmd")));
  /** Most of this list is updates Steam has already installed, so "Update all" takes only the
   *  mods the last Workshop check found out of date. */
  const behind = $derived(redownloadable.filter((c) => store.updateByUid.has(c.uid)));
</script>

<div class="scrim" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
  <div class="dlg card" role="dialog" aria-modal="true" aria-labelledby="chg-title">
    <div class="hd">
      <div><b id="chg-title">What changed</b><span class="sub">{since ? `Since ${since}` : "Since the previous launch"} · {store.changeSummary || "nothing"} · Circinus compares on every launch and keeps watching while open</span></div>
      <button class="x" aria-label="Close" onclick={close}>{@html I.close}</button>
    </div>

    <div class="body">
      {#if list}
        <section>
          <h4>Active list edited outside Circinus <span class="aside">ModsConfig.xml</span></h4>
          <p class="hint">RimWorld rewrites the list when you change mods in its own menu; other managers write it too. Circinus loaded the file as it is now.</p>
          {#if list.added.length}
            <h5>Added to the list <span class="aside">{list.added.length}</span></h5>
            <div class="pills">{#each list.added as p}<span class="pill add" title={p}>{@html I.plus}{nameOf(p)}</span>{/each}</div>
          {/if}
          {#if list.removed.length}
            <h5>Taken off the list <span class="aside">{list.removed.length}</span></h5>
            <div class="pills">{#each list.removed as p}<span class="pill rm" title={p}>{@html I.minus}{nameOf(p)}</span>{/each}</div>
          {/if}
          {#if list.reordered}
            <h5>Load order changed <span class="aside">{moves.length ? `${moves.length} moved` : ""}</span></h5>
            {#if moves.length}
              <p class="hint">The fewest moves that explain the new order, by their new place. Positions are the file's own numbering.</p>
              <div class="rows">
                {#each moves as mv (mv.packageId)}
                  <div class="row moved">
                    <span class="k">{@html mv.to < mv.from ? I.up : I.down}</span>
                    <span class="nm"><b>{nameOf(mv.packageId)}</b><span class="mono">{mv.packageId}</span></span>
                    <span class="pos num" title="Position before → after">#{mv.from} → #{mv.to}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="hint">The same mods in a different order.</p>
            {/if}
          {/if}
        </section>
      {/if}

      {#each groups as g (g.id)}
        <section>
          <h4>{g.title} <span class="aside">{g.items.length}</span></h4>
          <p class="hint">{g.hint}</p>
          <div class="rows">
            {#each g.items as c (c.uid)}
              <div class="row {c.kind}">
                <span class="k">{#if c.kind === "added"}{@html I.plus}{:else if c.kind === "removed"}{@html I.minus}{:else}{@html I.change}{/if}</span>
                <span class="nm">
                  <b>{c.name}</b>
                  <span>{describeChange(c)} · {SOURCE_LABEL[c.source]}{c.active && c.kind !== "removed" ? " · active" : ""}</span>
                </span>
                <span class="acts">
                  {#if c.publishedFileId}<button class="ib" title="Workshop changelog" onclick={() => changelog(c)}>{@html I.link}</button>{/if}
                  {#if c.kind !== "removed" && c.publishedFileId && (c.source === "workshop" || c.source === "steamcmd")}<button class="ib" title={c.source === "workshop" ? "Force update: download the current version into Steam's folder" : "Force update: replace your copy in Mods with the current version"} onclick={() => store.updateMods([c.uid])}>{@html I.download}</button>{/if}
                  {#if c.kind !== "removed"}<button class="btn sm" onclick={() => show(c)}>Show</button>{/if}
                </span>
              </div>
            {/each}
          </div>
        </section>
      {/each}

      {#if !groups.length && !list}
        <p class="hint">Nothing has changed since Circinus last looked.</p>
      {/if}
    </div>

    <div class="ft">
      <span class="sp"></span>
      {#if behind.length > 1}<button class="btn" title="Updates the mods the last Workshop check found out of date" onclick={() => store.updateMods(behind.map((c) => c.uid))}>{@html I.download}Update all {behind.length}</button>{/if}
      <button class="btn primary" onclick={() => store.acknowledgeChanges()}>{@html I.check}Got it, clear the list</button>
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(6px); display: grid; place-items: center; z-index: 40; }
  .dlg { width: min(760px, calc(100vw - 40px)); max-height: calc(100vh - 40px); padding: 18px 20px; box-shadow: var(--shadow-float); display: flex; flex-direction: column; gap: 14px; }
  .hd { display: flex; justify-content: space-between; align-items: flex-start; }
  .hd b { font-size: 16px; font-weight: 800; display: block; }
  .hd .sub { display: block; font-size: 12.5px; color: var(--text-3); margin-top: 2px; }
  .x { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--text-3); }
  .x:hover { background: var(--surface-2); color: var(--text); }
  .x :global(svg) { width: 14px; height: 14px; }
  .body { overflow: hidden auto; min-height: 0; display: flex; flex-direction: column; gap: 16px; padding-right: 4px; }
  h4 { margin: 0 0 4px; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-2); display: flex; align-items: center; gap: 8px; }
  h5 { margin: 10px 0 4px; font-size: 12px; font-weight: 700; color: var(--text-2); display: flex; align-items: center; gap: 8px; }
  .row.moved .k { background: var(--blue-soft); color: var(--blue); }
  .pos { font-size: 12px; color: var(--text-2); font-weight: 600; white-space: nowrap; }
  .aside { color: var(--text-3); font-weight: 600; letter-spacing: 0; text-transform: none; }
  .hint { margin: 0 0 8px; color: var(--text-3); font-size: 12.5px; line-height: 1.45; }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 7px; background: var(--surface-3); font-size: 12px; font-weight: 600; color: var(--text-2); }
  .pill :global(svg) { width: 10px; height: 10px; }
  .pill.add { color: var(--green); background: var(--green-soft); }
  .pill.rm { color: var(--red); background: var(--red-soft); }
  .rows { display: flex; flex-direction: column; gap: 2px; }
  .row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 9px; }
  .row:hover { background: var(--surface-2); }
  .k { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-3); color: var(--text-2); }
  .k :global(svg) { width: 11px; height: 11px; }
  .row.added .k { background: var(--green-soft); color: var(--green); }
  .row.removed .k { background: var(--red-soft); color: var(--red); }
  .row.updated .k { background: var(--amber-soft); color: var(--amber); }
  .nm { min-width: 0; display: flex; flex-direction: column; }
  .nm b { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm span { font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acts { display: flex; gap: 4px; align-items: center; }
  .ib { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--text-3); }
  .ib:hover { background: var(--surface-3); color: var(--text); }
  .ib :global(svg) { width: 14px; height: 14px; }
  .ft { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .sp { flex: 1; }
</style>

<script lang="ts">
  // The right-click menu for one mod or a selection. Opened by ModList (store.menu), closed on
  // any click elsewhere, Escape, or after an action. Submenus open on hover or click.
  import { tick } from "svelte";
  import { store } from "$lib/store.svelte";
  import { I } from "$lib/icons";
  import { openUrl } from "$lib/api";
  import { PHASES, SOURCE_LABEL, type ModInfo } from "$lib/types";

  const m = $derived(store.menu);
  const mods = $derived((m?.uids ?? []).map((u) => store.byUid.get(u)).filter((x): x is ModInfo => !!x));
  const one = $derived(mods.length === 1 ? mods[0] : null);
  const uids = $derived(mods.map((x) => x.uid));
  const allActive = $derived(mods.length > 0 && mods.every((x) => store.activeSet.has(x.uid)));
  const anyActive = $derived(mods.some((x) => store.activeSet.has(x.uid)));
  const allPinned = $derived(mods.length > 0 && mods.every((x) => store.pinned.has(x.uid)));
  const official = $derived(mods.every((x) => x.source === "ludeon"));
  const label = $derived(one ? one.name : `${mods.length} mods`);
  let el = $state<HTMLElement | null>(null);
  let pos = $state({ x: 0, y: 0 });
  /** Flyouts open to the left when the menu sits near the right edge. */
  const flip = $derived(pos.x + 236 + 230 > (typeof innerWidth === "number" ? innerWidth : 1600));
  let open = $state<"sort" | "group" | "copy" | null>(null);
  let confirmDelete = $state(false);
  let confirmUnsub = $state(false);
  let newGroup = $state(false);
  let newGroupName = $state("");

  $effect(() => {
    const mm = store.menu;
    open = null;
    confirmDelete = false;
    confirmUnsub = false;
    newGroup = false;
    if (!mm) return;
    pos = { x: mm.x, y: mm.y };
    clamp().then(() => (el?.querySelector("button") as HTMLElement | null)?.focus());
  });

  /** Keep the menu inside the window — also after it grows, as a confirmation makes it do. */
  async function clamp() {
    await tick();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(pos.x, innerWidth - r.width - 8);
    const y = Math.min(pos.y, innerHeight - r.height - 8);
    pos = { x: Math.max(8, x), y: Math.max(8, y) };
  }

  function close() {
    store.menu = null;
  }
  /** Do the action first, while `uids` still describes the menu's mods, then close. */
  function run(f: () => unknown) {
    f();
    close();
  }
  function onWindowDown(e: MouseEvent) {
    if (m && el && !el.contains(e.target as Node)) close();
  }
  // Escape is one handler now, in the store, ordered by how close a thing is to the user. This
  // menu is the closest there is, so it goes on top; before, five window listeners raced and
  // closing this one also cleared the selection behind it.
  $effect(() => store.onEscape("menu", 60, () => !!m, close));
  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(() => store.say(`${what} copied`), () => store.say("Could not copy", "warn"));
  }
  function moveToEdge(top: boolean) {
    const sel = uids.filter((u) => store.activeSet.has(u));
    if (!sel.length) return;
    const rest = store.active.filter((u) => !sel.includes(u));
    // Core and the DLC stay on top; a mod moved "to the top" goes right under them.
    const officialTop = top ? rest.filter((u) => store.byUid.get(u)?.source === "ludeon") : [];
    const others = top ? rest.filter((u) => !officialTop.includes(u)) : rest;
    store.setActive(top ? [...officialTop, ...sel, ...others] : [...others, ...sel]);
  }
  function makeGroup() {
    if (!newGroupName.trim()) return;
    store.addGroup(newGroupName, { members: [...uids] });
    newGroupName = "";
    close();
  }
  const canDelete = $derived(mods.length > 0 && mods.every((x) => x.source !== "ludeon" && x.source !== "workshop"));
  /** Only Steam's own copies can be copied out of Steam's folder, and only once. */
  const localizable = $derived(mods.filter((x) => x.source === "workshop" && x.publishedFileId));
  const workshopOnly = $derived(mods.length > 0 && mods.every((x) => x.source === "workshop"));
  /** Steam can only unsubscribe from what it put there, so only those are offered. */
  const subscribed = $derived(mods.filter((x) => x.publishedFileId && x.source === "workshop" && store.subscriptions[x.publishedFileId] !== "absent"));
  const workshopUrl = (x: ModInfo) => (x.publishedFileId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${x.publishedFileId}` : x.url);
  /** Force update replaces a mod in the folder it is installed in: Steam's folder for a Steam mod,
   *  Mods for a copy Circinus made. Other local folders are never offered it. */
  const redownloadable = $derived(mods.filter((x) => x.publishedFileId && (x.source === "workshop" || x.source === "steamcmd")));
</script>

<svelte:window onmousedown={onWindowDown} />

{#if m && mods.length}
  <div class="menu card" bind:this={el} style="left: {pos.x}px; top: {pos.y}px" role="menu" aria-label="Actions for {label}">
    <div class="head"><b>{label}</b>{#if one}<span class="mono">{one.packageId}</span>{:else}<span>{mods.filter((x) => store.activeSet.has(x.uid)).length} active</span>{/if}</div>

    {#if allActive}
      <button class="it" role="menuitem" onclick={() => run(() => store.deactivate(uids))}>{@html I.minus}Deactivate</button>
    {:else}
      <button class="it" role="menuitem" onclick={() => run(() => store.activate(uids.filter((u) => !store.activeSet.has(u))))}>{@html I.plus}Activate{anyActive ? " the rest" : ""}</button>
    {/if}
    {#if anyActive}
      <button class="it" role="menuitem" onclick={() => run(() => moveToEdge(true))}>{@html I.up}Move to top</button>
      <button class="it" role="menuitem" onclick={() => run(() => moveToEdge(false))}>{@html I.down}Move to bottom</button>
      <button class="it" role="menuitemcheckbox" aria-checked={allPinned} onclick={() => run(() => store.setPinned(uids, !allPinned))}>{@html I.pin}{allPinned ? "Let HALO move it again" : "Keep its position when sorting"}</button>
    {/if}

    <div class="sep"></div>
    <div class="sub" role="presentation" onmouseenter={() => (open = "sort")}>
      <button class="it" role="menuitem" aria-haspopup="menu" aria-expanded={open === "sort"} onclick={() => (open = open === "sort" ? null : "sort")}>{@html I.halo}Sort it as<span class="arrow">›</span></button>
      {#if open === "sort"}
        {@const cur = one ? store.sortAsOf(one.uid) : ""}
        <div class="menu card flyout" class:left={flip} role="menu">
          <button class="it" role="menuitemradio" aria-checked={cur === ""} onclick={() => run(() => store.setSortAs(uids, ""))}><span class="chk">{cur === "" ? "•" : ""}</span>Let HALO decide</button>
          {#each PHASES as p}
            <button class="it" role="menuitemradio" aria-checked={cur === p.id} onclick={() => run(() => store.setSortAs(uids, p.id))}><span class="chk">{cur === p.id ? "•" : ""}</span><span class="dot c-{p.color}"></span>{p.name}</button>
            {#each store.sectionGroups.filter((g) => g.phase === p.id) as g}
              <button class="it" role="menuitemradio" aria-checked={cur === `group:${g.id}`} onclick={() => run(() => store.setSortAs(uids, `group:${g.id}`))}><span class="chk">{cur === `group:${g.id}` ? "•" : ""}</span><span class="dot c-{g.color}"></span>{g.name}<span class="aside">your group</span></button>
            {/each}
          {/each}
        </div>
      {/if}
    </div>
    <div class="sub" role="presentation" onmouseenter={() => (open = "group")}>
      <button class="it" role="menuitem" aria-haspopup="menu" aria-expanded={open === "group"} onclick={() => (open = open === "group" ? null : "group")}>{@html I.library}Group<span class="arrow">›</span></button>
      {#if open === "group"}
        {@const byHand = one ? store.snap?.user.modGroups[one.uid] ?? "" : null}
        {@const cur = one ? store.groupOf(one.uid)?.id ?? "" : null}
        <div class="menu card flyout" class:left={flip} role="menu">
          <button class="it" role="menuitemradio" aria-checked={cur === ""} title={cur && !byHand ? "It is in that group by the group's own rule; None is its hand-picked state already" : ""} onclick={() => run(() => store.setGroup(uids, null))}><span class="chk">{cur === "" ? "•" : ""}</span>None</button>
          {#each store.snap?.user.groups ?? [] as g}
            <button class="it" role="menuitemradio" aria-checked={cur === g.id} onclick={() => run(() => store.setGroup(uids, g.id))}><span class="chk">{cur === g.id ? "•" : ""}</span><span class="dot c-{g.color}"></span>{g.name}{#if cur === g.id && !byHand}<span class="aside">by its rule</span>{/if}</button>
          {/each}
          <div class="sep"></div>
          {#if newGroup}
            <form class="newg" onsubmit={(e) => { e.preventDefault(); makeGroup(); }}>
              <input class="input" placeholder="Group name" bind:value={newGroupName} />
              <button class="btn sm primary" type="submit">Add</button>
            </form>
          {:else}
            <button class="it" role="menuitem" onclick={() => { newGroup = true; tick().then(() => (el?.querySelector(".newg input") as HTMLElement | null)?.focus()); }}>{@html I.plus}New group…</button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="sep"></div>
    {#if one}
      <button class="it" role="menuitem" onclick={() => run(() => store.openFolder(one.linkTarget ?? one.path))}>{@html I.folder}Open folder</button>
      {#if workshopUrl(one)}<button class="it" role="menuitem" onclick={() => run(() => openUrl(workshopUrl(one)!))}>{@html I.cloud}Workshop page</button>{/if}
      <div class="sub" role="presentation" onmouseenter={() => (open = "copy")}>
        <button class="it" role="menuitem" aria-haspopup="menu" aria-expanded={open === "copy"} onclick={() => (open = open === "copy" ? null : "copy")}>{@html I.list}Copy<span class="arrow">›</span></button>
        {#if open === "copy"}
          <div class="menu card flyout" class:left={flip} role="menu">
            <button class="it" role="menuitem" onclick={() => run(() => copy(one.name, "Name"))}>Name</button>
            {#if one.packageId}<button class="it" role="menuitem" onclick={() => run(() => copy(one.packageId, "packageId"))}>packageId</button>{/if}
            {#if one.publishedFileId}<button class="it" role="menuitem" onclick={() => run(() => copy(String(one.publishedFileId), "Workshop id"))}>Workshop id</button>{/if}
            {#if workshopUrl(one)}<button class="it" role="menuitem" onclick={() => run(() => copy(workshopUrl(one)!, "Link"))}>Workshop link</button>{/if}
            <button class="it" role="menuitem" onclick={() => run(() => copy(one.linkTarget ?? one.path, "Folder path"))}>Folder path</button>
          </div>
        {/if}
      </div>
    {:else}
      <button class="it" role="menuitem" onclick={() => run(() => copy(mods.map((x) => x.packageId || x.name).join("\n"), `${mods.length} packageIds`))}>{@html I.list}Copy packageIds</button>
    {/if}

    {#if localizable.length || redownloadable.length || workshopOnly || canDelete}<div class="sep"></div>{/if}
    {#if localizable.length}
      <button
        class="it"
        role="menuitem"
        title="Copies the mod's files from Steam's folder into your own Mods folder and loads that copy. Steam never touches the Mods folder, so an update to the Workshop item cannot change what your game reads. Circinus still tells you when the author has published something newer."
        onclick={() => run(() => localizable.forEach((x) => store.localizeMod(x.uid)))}
      >{@html I.save}Keep my own copy{localizable.length > 1 ? ` (${localizable.length})` : ""}</button>
    {/if}
    {#if redownloadable.length}
      <button class="it" role="menuitem" title="Downloads the current version with SteamCMD into the folder the mod is installed in: Steam's folder for a Steam mod, Mods for a copy Circinus made. Other local folders are never changed." onclick={() => run(() => store.updateMods(redownloadable.map((x) => x.uid)))}>{@html I.download}Force update{redownloadable.length > 1 ? ` (${redownloadable.length})` : ""}</button>
    {/if}
    {#if workshopOnly && subscribed.length}
      {#if confirmUnsub}
        <button class="it danger" role="menuitem" onclick={() => run(() => store.unsubscribeIds(subscribed.map((x) => x.publishedFileId!)))}>{@html I.error}Yes, unsubscribe {one ? "it" : `${subscribed.length} mods`}</button>
        <div class="foot">Steam deletes the mod's folder when you unsubscribe. Circinus cannot undo that; subscribing again downloads it afresh.</div>
      {:else}
        <button class="it danger" role="menuitem" title="Steam owns this folder. This opens the mod's page in Steam, where Unsubscribe is one press; Steam then deletes the folder." onclick={() => { confirmUnsub = true; clamp(); }}>{@html I.minus}Unsubscribe in Steam…</button>
      {/if}
    {/if}
    {#if canDelete}
      {#if confirmDelete}
        <button class="it danger" role="menuitem" onclick={() => run(() => uids.forEach((u) => store.deleteMod(u)))}>{@html I.error}Yes, delete {one ? "it" : `${mods.length} mods`}</button>
      {:else}
        <button class="it danger" role="menuitem" title={one?.linkTarget ? "Removes the link in your Mods folder; the folder it points at stays" : "Moves the folder to the recycle bin"} onclick={() => (confirmDelete = true)}>{@html I.close}Delete{one?.linkTarget ? " the link" : ""}…</button>
      {/if}
    {/if}
    {#if official}<div class="foot">{one ? SOURCE_LABEL[one.source] : "Official content"}: the game's own files stay put.</div>{/if}
  </div>
{/if}

<style>
  .menu { position: fixed; z-index: 60; min-width: 236px; max-width: 320px; padding: 6px; display: flex; flex-direction: column; gap: 1px; box-shadow: var(--shadow-float); }
  .head { padding: 6px 10px 8px; display: flex; flex-direction: column; gap: 2px; }
  .head b { font-size: 13px; }
  .head span { color: var(--text-3); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .it { display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 10px; border-radius: 8px; font-size: 13px; color: var(--text-2); text-align: left; width: 100%; white-space: nowrap; }
  .it :global(svg) { width: 15px; height: 15px; flex: none; }
  .it:hover, .it:focus-visible { background: var(--surface-2); color: var(--text); }
  .it.danger { color: var(--red); }
  .it .arrow { margin-left: auto; color: var(--text-3); font-size: 16px; }
  .it .aside { margin-left: auto; color: var(--text-3); font-size: 11px; }
  .it .chk { width: 12px; flex: none; text-align: center; color: var(--amber); }
  .sep { height: 1px; background: rgba(255, 255, 255, 0.07); margin: 4px 6px; }
  .sub { position: relative; }
  .flyout { position: absolute; left: calc(100% - 4px); top: -6px; min-width: 220px; max-height: 70vh; overflow: hidden auto; }
  .flyout.left { left: auto; right: calc(100% - 4px); }
  .newg { display: flex; gap: 6px; padding: 4px 6px; }
  .newg .input { height: 28px; font-size: 12.5px; }
  .foot { padding: 6px 10px 4px; color: var(--text-3); font-size: 11.5px; }
</style>

// Words a player reads that never went through the catalogue.
//
//   node tools/i18n-check.mjs          fail on a hardcoded string in a converted file
//   node tools/i18n-check.mjs --todo   how much is left, file by file
//
// Extracting four hundred strings is not one commit's work, so this carries the ledger: PENDING
// lists the files still holding their own English. A file leaves that list when it is converted,
// and the check then guards it forever. The list only ever shrinks — adding to it is how the
// problem comes back, so a new file is guarded from the day it is written.
//
// What counts as user-facing: a text node that starts with a capital and has a space in it, and
// the attributes a person actually reads (title, placeholder, aria-label). Not class names, not
// `data-` anything, not a lone word inside a tag, and not anything already inside `t(`.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Not converted yet. Remove a file when it is done; never add one. */
const PENDING = new Set([
  "AnalyzerView.svelte",
  "Banner.svelte",
  "ChangesDialog.svelte",
  "CollectionDialog.svelte",
  "ContextMenu.svelte",
  "DefsView.svelte",
  "DownloadsView.svelte",
  "GameLog.svelte",
  "GroupEditor.svelte",
  "HaloView.svelte",
  "ImportDialog.svelte",
  "Inspector.svelte",
  "InstancesDialog.svelte",
  "ModList.svelte",
  "MovesView.svelte",
  "Panel.svelte",
  "Rail.svelte",
  "SettingsView.svelte",
  "Stats.svelte",
  "TexturesView.svelte",
  "TitleBar.svelte"
]);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIR = join(ROOT, "src/components");

/** Text between tags: `>Some words<`. A single word is usually a label already in a table, and
 *  demanding a key for every `>Cost<` would drown the real ones. */
const TEXT = />\s*([A-Z][^<>{}]*\s+[^<>{}]*?)\s*</g;
/** The attributes somebody reads. A value starting `{` is already an expression. */
const ATTR = /\b(title|placeholder|aria-label)="([^"{][^"]*)"/g;

function findings(src) {
  const out = [];
  // Strip the script and style blocks: strings in the script are caught by their own review, and
  // a selector in CSS is not English.
  const markup = src.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  for (const m of markup.matchAll(TEXT)) {
    const text = m[1].trim();
    if (text.length < 6) continue;
    out.push(text.slice(0, 70));
  }
  for (const m of markup.matchAll(ATTR)) out.push(`${m[1]}="${m[2].slice(0, 60)}"`);
  return out;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".svelte")).sort();
const todo = process.argv.includes("--todo");
let failed = 0;
const rows = [];

for (const f of files) {
  const found = findings(readFileSync(join(DIR, f), "utf8"));
  const pending = PENDING.has(f);
  rows.push({ f, n: found.length, pending });
  if (pending || found.length === 0) continue;
  failed += found.length;
  console.log(`\n${f}: ${found.length} string${found.length === 1 ? "" : "s"} not in the catalogue`);
  for (const s of found.slice(0, 20)) console.log(`   ${s}`);
  if (found.length > 20) console.log(`   …and ${found.length - 20} more`);
}

// A file in the ledger that has nothing left in it is a file somebody converted and forgot to
// take off the list. Say so: the ledger is only useful while it is true.
const stale = rows.filter((r) => r.pending && r.n === 0).map((r) => r.f);
if (stale.length) {
  console.log(`\nConverted but still listed as pending: ${stale.join(", ")}`);
  console.log("Remove them from PENDING in tools/i18n-check.mjs so the check starts guarding them.");
  failed += stale.length;
}

if (todo) {
  const left = rows.filter((r) => r.pending && r.n > 0).sort((a, b) => b.n - a.n);
  const total = left.reduce((s, r) => s + r.n, 0);
  console.log(`\n${left.length} files left, about ${total} strings:\n`);
  for (const r of left) console.log(`  ${String(r.n).padStart(4)}  ${r.f}`);
  const done = rows.filter((r) => !r.pending);
  console.log(`\nconverted: ${done.map((r) => r.f).join(", ") || "(none)"}`);
}

if (failed && !todo) {
  console.log(`\n${failed} problem${failed === 1 ? "" : "s"}. A string a player reads belongs in src/lib/locales/en.ts, reached with t("some.key").`);
  process.exit(1);
}
if (!todo) console.log(`i18n: ${rows.filter((r) => !r.pending).length} of ${rows.length} components converted, and clean.`);

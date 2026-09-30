// A key made by gluing two fields together is not a key.
//
//   node tools/each-key-check.mjs
//
// Svelte treats a duplicate key in a keyed `{#each}` as fatal: the block throws, the boundary
// catches it, and the whole screen becomes an error. So a key that is *usually* unique is a
// screen that usually works.
//
// This exists because one shipped. The Defs report keyed its overwrite chains by
// `(c.def + c.path)`, which is unique right up until two mods overwrite the same field of the
// same def -- certain on a real load order, impossible on the forty-mod mock. Every copy of the
// app with a real Defs report showed `each_key_duplicate` instead of the report.
//
// The rule: a key expression that concatenates is only allowed when it includes the block's own
// index, because that is the one part that cannot repeat. Everything else must be a single
// expression, and it is on the author to know that one is an id.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../src/components", import.meta.url));

/** `{#each thing as x, i (key)}` and `{#each thing as x (key)}`. */
const EACH = /\{#each\s+([\s\S]*?)\s+as\s+([A-Za-z0-9_$[\]{},\s]+?)\s*\(([^)]*)\)\s*\}/g;

let failed = 0;
let keyed = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".svelte")).sort()) {
  const src = readFileSync(join(DIR, file), "utf8");
  for (const m of src.matchAll(EACH)) {
    const [whole, , binding, key] = m;
    keyed++;
    if (!key.includes("+")) continue;
    // The index is whatever follows the comma in `as row, i`.
    const index = binding.includes(",") ? binding.split(",").pop().trim() : null;
    const usesIndex = index && new RegExp(`\\b${index.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(key);
    if (usesIndex) continue;
    failed++;
    const line = src.slice(0, m.index).split("\n").length;
    console.log(`\n${file}:${line}  the key is built by concatenation and cannot be trusted to be unique`);
    console.log(`   ${whole.trim().slice(0, 110)}`);
    console.log(`   Either key by something that is genuinely an id, or add the index: \`as ${binding.split(",")[0].trim()}, i (i)\`.`);
  }
}

if (failed) {
  console.log(`\n${failed} key${failed === 1 ? "" : "s"} that a big enough list will break. Svelte treats a duplicate key as fatal, so this is a whole screen, not a row.`);
  process.exit(1);
}
console.log(`each keys: ${keyed} keyed blocks, none built by concatenation.`);

// Does every command the window calls actually exist on the other side?
//
//   node tools/commands-check.mjs
//
// This exists because of a bug that shipped. "Open folder" was rewired to the opener plugin's
// `open_path`, the capability file already listed `opener:allow-open-path`, and that looked like
// permission. It is not: that command is scope-checked, a permission listed with no `allow` list
// has an *empty* scope, and an empty scope refuses every path on every machine, always. So the
// button failed for everyone, and the browser mock could not have caught it -- outside Tauri the
// call is a no-op that logs, so the loadtest proved the call site was right and could never prove
// the call worked.
//
// The general lesson is that the window and the backend agree by convention and nothing checks
// it. This checks the part that can be checked from here: every `invoke("x")` in `api.ts` is a
// command registered in `generate_handler!`, and nothing reaches for a plugin command the
// capability file does not really grant.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const api = readFileSync(join(ROOT, "src/lib/api.ts"), "utf8");
const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
const capability = readFileSync(join(ROOT, "src-tauri/capabilities/default.json"), "utf8");

let failed = 0;
const fail = (why, detail) => {
  failed++;
  console.log(`\n${why}`);
  for (const d of detail) console.log(`   ${d}`);
};

// ---- every command the window invokes is registered -------------------------------------------
const invoked = [...api.matchAll(/invoke<[^>]*>\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
// Commands come from several modules -- `commands::`, `defs::`, `patches::`, `updater::` -- so
// read the handler block itself rather than guessing at the module name.
const block = lib.slice(lib.indexOf("generate_handler!["), lib.indexOf("]", lib.indexOf("generate_handler![")));
const registered = new Set([...block.matchAll(/(?:[a-z0-9_]+::)+([a-z0-9_]+)/g)].map((m) => m[1]));
const missing = [...new Set(invoked)].filter((c) => !registered.has(c));
if (missing.length) {
  fail(`${missing.length} command${missing.length === 1 ? "" : "s"} the window calls but nothing registers:`, missing);
  console.log("   Add them to `tauri::generate_handler![…]` in src-tauri/src/lib.rs.");
}

// ---- and nothing is registered that no one calls ----------------------------------------------
// Not a failure: a command can be called from Rust, or kept for the next thing. Worth printing.
const unused = [...registered].filter((c) => !invoked.includes(c));

// ---- the trap that caused this ------------------------------------------------------------------
// `open_path` is the opener plugin's, and it is scope-checked. Reaching for it from the window
// means the capability must carry an `allow` list of paths -- and there is no honest one to write,
// since a mod folder is wherever the player put it. `commands::open_folder` is the answer: Rust
// checks `is_dir` and calls the plugin's Rust API, which the ACL does not gate.
if (/plugin-opener[\s\S]{0,400}?\bopenPath\b/.test(api)) {
  const scoped = /"opener:allow-open-path"/.test(capability);
  fail("src/lib/api.ts reaches for the opener plugin's openPath from the window.", [
    scoped
      ? "The capability lists `opener:allow-open-path` as a bare string, which is an EMPTY scope: it refuses every path."
      : "Nothing in the capability grants it a path scope, so it refuses every path.",
    "Use the `open_folder` command instead -- Rust checks the path is a folder and calls the plugin's Rust API, which is not scope-gated."
  ]);
}

if (failed) {
  console.log(`\n${failed} problem${failed === 1 ? "" : "s"}. The window and the backend have to agree, and nothing else checks that they do.`);
  process.exit(1);
}
console.log(`commands: ${new Set(invoked).size} invoked, all registered${unused.length ? `; ${unused.length} registered and called only from Rust` : ""}.`);

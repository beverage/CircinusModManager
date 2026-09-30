#!/usr/bin/env node
// The checks a release runs, run before pushing instead of at release time.
//
//   npm run verify
//
// This is the list tools/release.mjs runs before it tags: the front-end checks and a production
// build, three loadtests and cargo test. The release workflow runs most of it again on Windows,
// macOS and Linux before it builds. Two more loadtests that need no browser, moves and chords,
// run here as well, and so does cargo clippy, as CLAUDE.md asks. Clippy's warnings are listed
// but do not fail the run, because the ones already in the code would fail every run; an error
// still does. The Checks workflow runs this same command on every push
// to main and every pull request, so this file is the one place the list is kept.
//
// Every step runs even after one fails, so a single run shows everything there is to fix.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// npm is a .cmd file on Windows, and Node will not start one without a shell. None of the
// arguments below contain a space, so the shell has nothing to split.
const needsShell = (cmd) => process.platform === "win32" && cmd === "npm";
const loadtest = (file) => [file, process.execPath, [path.join("tools", "loadtest", file)]];

const STEPS = [
  ["npm run check", "npm", ["run", "check"]],
  ["npm run build", "npm", ["run", "build"]],
  loadtest("moves.cjs"),
  loadtest("chords.cjs"),
  loadtest("push-build.cjs"),
  loadtest("release-args.mjs"),
  loadtest("release-tag.mjs"),
  ["cargo test", "cargo", ["test", "--workspace", "--locked"]],
  ["cargo clippy", "cargo", ["clippy", "--workspace", "--all-targets", "--locked", "--message-format=short"]],
];

if (!existsSync(path.join(ROOT, "node_modules"))) {
  console.error("node_modules is missing. Run npm install (or npm ci) first, then npm run verify.");
  process.exit(1);
}

const results = [];
for (const [name, cmd, args] of STEPS) {
  console.log(`\n== ${name}`);
  const started = Date.now();
  const run = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: needsShell(cmd) });
  if (run.error) console.error(`Could not start ${cmd}: ${run.error.message}`);
  results.push({ name, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log("\n== Summary");
for (const r of results) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}  ${r.seconds}s`);
const failed = results.filter((r) => !r.ok).length;
if (failed) {
  console.log(`\n${failed} of ${results.length} failed.`);
  process.exit(1);
}
console.log("\nAll passed: this is what the release will check.");

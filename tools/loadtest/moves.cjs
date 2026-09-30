// The arithmetic behind "what HALO would change": telling the mods it lifts out of their place
// apart from the mods whose number changes only because a lifted one passed them. No browser —
// the module is bundled with esbuild and called directly.
//
// node tools/loadtest/moves.cjs
const { buildSync } = require('esbuild');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..', '..');
const bundle = path.join(os.tmpdir(), `circinus-moves-${process.pid}.cjs`);
// esbuild's own API rather than `npx esbuild`: npx is a .cmd file on Windows, and Node will not
// start one without a shell.
buildSync({ absWorkingDir: root, entryPoints: ['src/lib/moves.ts'], bundle: true, format: 'cjs', outfile: bundle, logLevel: 'error' });
const { analyseMoves } = require(bundle);

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const content = () => 'content';
const run = (cur, prop, now = content, next = content, why = () => '') => analyseMoves(cur, prop, now, next, why);

// One mod carried from the bottom to the top. One decision; nine hundred and ninety-nine numbers.
{
  const cur = Array.from({ length: 1000 }, (_, i) => 'm' + i);
  const r = run(cur, ['m999', ...cur.slice(0, 999)]);
  ok('one mod lifted is one move', r.relocations.length === 1, `${r.relocations.length}`);
  ok('and the rest of the list is drift', r.drift === 999, `${r.drift}`);
  ok('it lands at the top, with nothing above it', r.relocations[0].to === 0 && !r.relocations[0].afterUid && r.relocations[0].beforeUid === 'm0');
  ok('and remembers what it used to follow', r.relocations[0].wasAfterUid === 'm998');
}

// A thousand mods with forty pulled out of place: forty moves to read, not seven hundred.
{
  const n = 1000, k = 40;
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const prop = Array.from({ length: n }, (_, i) => 'm' + i);
  const cur = [...prop];
  const pulled = new Set();
  for (let i = 0; i < k; i++) {
    const f = Math.floor(rnd() * cur.length);
    pulled.add(cur[f]);
    const [u] = cur.splice(f, 1);
    cur.splice(Math.floor(rnd() * cur.length), 0, u);
  }
  const r = run(cur, prop);
  ok('forty displaced mods read as about forty moves', r.relocations.length <= k + 2, `${r.relocations.length} moves, ${r.drift} drifting`);
  ok('and the drift is most of the list', r.drift > 100, `${r.drift}`);
  ok('every move names a mod that really was pulled out', r.relocations.every((x) => pulled.has(x.uid)));
  ok('the moves are listed in the order they end up in', r.relocations.every((x, i, a) => i === 0 || a[i - 1].to < x.to));
  ok('what it reports adds up to what the sort reports', r.relocations.length + r.drift === cur.filter((u, i) => prop.indexOf(u) !== i).length, `${r.relocations.length} + ${r.drift}`);
}

// Two orders that agree have nothing to say.
{
  const cur = Array.from({ length: 300 }, (_, i) => 'm' + i);
  const r = run(cur, [...cur]);
  ok('an unchanged order has no moves and no drift', r.relocations.length === 0 && r.drift === 0);
}

// Phases: only the mods that change phase are counted as changing phase.
{
  const r = run(['a', 'b', 'c'], ['c', 'a', 'b'], () => 'content', (u) => (u === 'c' ? 'framework' : 'content'), () => 'why');
  ok('a phase change is counted once', r.crossPhase === 1 && r.relocations[0].uid === 'c');
  ok("HALO's own reason comes through", r.relocations[0].reason === 'why');
  ok('the phases left and landed in are reported', r.fromPhases.join() === 'content' && r.toPhases.join() === 'framework');
}

// A list that changed under us: a mod in one order and not the other is left out, not thrown at.
{
  const r = run(['a', 'b', 'x'], ['b', 'a', 'y']);
  ok('a mod missing from one order is left out', r.relocations.every((m) => m.uid !== 'x' && m.uid !== 'y'), r.relocations.map((m) => m.uid).join());
}

// A thousand mods reordered end to end: still fast, and still honest about how much moves.
{
  const n = 1200;
  let s = 3;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const prop = Array.from({ length: n }, (_, i) => 'm' + i);
  const cur = [...prop].sort(() => rnd() - 0.5);
  const t0 = Date.now();
  const r = run(cur, prop);
  const ms = Date.now() - t0;
  ok('a wholly shuffled list is still read in a moment', ms < 200, `${ms} ms for ${r.relocations.length} moves`);
  ok('and most of it really does move', r.relocations.length > n / 2, `${r.relocations.length} of ${n}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

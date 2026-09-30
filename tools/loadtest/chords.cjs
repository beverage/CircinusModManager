// Reading a keystroke: the rules, without a browser.
//
// `src/lib/chord.ts` has no runes and no store precisely so it can be bundled and called, the
// way `moves.cjs` does with the move arithmetic. The Mac path is a parameter rather than a
// sniffed global, which is the only way this machine can check what a Mac would be told to press.
//
//   node tools/loadtest/chords.cjs
const { buildSync } = require('esbuild');
const { mkdtempSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const root = join(__dirname, '..', '..');
const bundle = join(mkdtempSync(join(tmpdir(), 'chord-')), 'chord.cjs');
// esbuild's own API, as in moves.cjs: npx is a .cmd file on Windows, and Node will not start one
// without a shell.
buildSync({ absWorkingDir: root, entryPoints: ['src/lib/chord.ts'], bundle: true, format: 'cjs', outfile: bundle, logLevel: 'error' });
const { chord, matches, keyLabel } = require(bundle);

let failures = 0;
function ok(label, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}
/** A keydown as the DOM would report it. */
const ev = (key, m = {}) => ({ key, ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift, altKey: !!m.alt });

// ---- parsing -------------------------------------------------------------------------------
const c = chord('Mod+Shift+p');
ok('a chord parses its parts', c.key === 'p' && c.mod === true && c.shift === true && c.alt === false, JSON.stringify(c));
ok('a bare key has no modifiers', (() => { const x = chord('F8'); return x.key === 'F8' && !x.mod && !x.shift && !x.alt; })());

// ---- Mod is the platform's key -------------------------------------------------------------
ok('Ctrl+S saves off a Mac', matches(ev('s', { ctrl: true }), chord('Mod+s'), false));
ok('and Cmd+S saves on one', matches(ev('s', { meta: true }), chord('Mod+s'), true));
// The one that matters: on a Mac, Ctrl is a different key and must not stand in for Cmd.
ok('Ctrl+S is not Cmd+S on a Mac', !matches(ev('s', { ctrl: true }), chord('Mod+s'), true));
ok('and Cmd+S is not Ctrl+S elsewhere', !matches(ev('s', { meta: true }), chord('Mod+s'), false));

// ---- the bug this replaces -----------------------------------------------------------------
// The old handler tested `ctrlKey || metaKey` and said nothing about the rest, so devtools
// opened the Import dialog.
ok('Ctrl+Shift+I is not Ctrl+I', !matches(ev('i', { ctrl: true, shift: true }), chord('Mod+i'), false));
ok('Ctrl+Alt+D is not Ctrl+D', !matches(ev('d', { ctrl: true, alt: true }), chord('Mod+d'), false));
ok('a plain letter is not a chord', !matches(ev('s'), chord('Mod+s'), false));
ok('and a chord is not a plain letter', !matches(ev('s', { ctrl: true }), chord('s'), false));

// ---- Shift, which is not like the others ---------------------------------------------------
ok('Shift+F8 needs Shift', matches(ev('F8', { shift: true }), chord('Shift+F8'), false));
ok('F8 alone is not Shift+F8', !matches(ev('F8'), chord('Shift+F8'), false));
ok('and Shift+F8 is not F8', !matches(ev('F8', { shift: true }), chord('F8'), false));
// `?` cannot be typed without Shift, so requiring Shift to be up would bind nothing at all.
ok('? matches with Shift held, as a keyboard sends it', matches(ev('?', { shift: true }), chord('?'), false));

// ---- case, because e.key reports the shifted character ---------------------------------------
ok('a capital letter from Shift still matches its key', matches(ev('S', { ctrl: true, shift: true }), chord('Mod+Shift+s'), false));

// ---- labels ----------------------------------------------------------------------------------
ok('a PC is told Ctrl', keyLabel('Mod+s', false) === 'Ctrl S', keyLabel('Mod+s', false));
ok('and a Mac is not', keyLabel('Mod+s', true) === '⌘S', keyLabel('Mod+s', true));
ok('modifiers stack in order', keyLabel('Mod+Shift+p', false) === 'Ctrl Shift P', keyLabel('Mod+Shift+p', false));
ok('and stack as symbols on a Mac', keyLabel('Mod+Shift+p', true) === '⌘⇧P', keyLabel('Mod+Shift+p', true));
ok('named keys keep their names', keyLabel('F8', false) === 'F8', keyLabel('F8', false));
ok('arrows are drawn', keyLabel('Alt+ArrowUp', false) === 'Alt ↑', keyLabel('Alt+ArrowUp', false));
ok('Enter is a word on a PC', keyLabel('Mod+Enter', false) === 'Ctrl Enter', keyLabel('Mod+Enter', false));
// A key that needs Shift to exist is not also told to hold Shift.
ok('? is printed as ?', keyLabel('?', false) === '?', keyLabel('?', false));

console.log(failures ? `\n${failures} failed.` : '\nall good');
process.exit(failures ? 1 : 0);

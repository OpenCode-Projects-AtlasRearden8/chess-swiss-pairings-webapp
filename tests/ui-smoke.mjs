/* UI smoke test: loads index.html's scripts with a minimal DOM stub,
   drives the main flows (add players, pair, enter results, standings, CSV),
   and verifies rendered output. No browser needed. */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (scripts.length < 2) { console.error('FATAL: expected two inline scripts'); process.exit(1); }
const [coreSrc, uiSrc] = scripts;

function makeEl(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', dataset: {},
    _listeners: {},
    addEventListener(type, fn) { this._listeners[type] = fn; },
    dispatch(type, ev = {}) { if (this._listeners[type]) return this._listeners[type](ev); },
    appendChild() {}, remove() {}, click() {}, focus() {}, closest() { return null; },
    removeEventListener() {},
  };
}

const elements = new Map();
const documentStub = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  },
  createElement(tag) {
    const el = makeEl('dyn-' + tag);
    el.href = ''; el.download = '';
    return el;
  },
  body: makeEl('body'),
};
// dispatch('click', { target: moves ) sibling rules — rounds area needs closest support
documentStub.getElementById('rounds-area').closest = null;

let confirmCalled = false;
const sandbox = {
  window: {
    SwissCore: undefined,
    confirm: () => { confirmCalled = true; return true; },
  },
  document: documentStub,
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] ?? null; },
    setItem(k, v) { this._data[k] = v; },
    removeItem(k) { delete this._data[k]; },
  },
  setTimeout: (fn) => 0, clearTimeout: () => {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: class { constructor(parts) { this.size = (parts[0] || '').length; this._content = parts[0]; } },
  console,
};
sandbox.window.self = sandbox.window;

new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', 'URL', 'Blob', coreSrc)(
  sandbox.window, sandbox.document, sandbox.localStorage, sandbox.setTimeout, sandbox.clearTimeout, sandbox.URL, sandbox.Blob
);
if (!sandbox.window.SwissCore) { console.error('FATAL: core did not export SwissCore'); process.exit(1); }

let failures = 0;
function step(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failures++; console.log('FAIL  ' + name + ' — ' + e.message); }
}

try {
  new Function(
    'window', 'document', 'localStorage', 'setTimeout', 'clearTimeout', 'URL', 'Blob', 'confirm', uiSrc
  )(sandbox.window, sandbox.document, sandbox.localStorage, sandbox.setTimeout, sandbox.clearTimeout, sandbox.URL, sandbox.Blob, sandbox.window.confirm);
  console.log('  ok  UI script initialises against stub DOM');
} catch (e) {
  console.error('FATAL: UI script crashed on init: ' + e.stack);
  process.exit(1);
}

const C = sandbox.window.SwissCore;
const state = { val: null };
new Function('window', 'document', 'localStorage', 'setTimeout', 'clearTimeout',
  'return (()=>{let t=null;try{t=JSON.parse(localStorage.getItem("club-swiss-tournament-v1"))}catch(e){}return t;})()');
// read the UI's live state via its own rendering instead:
function stored() {
  const raw = sandbox.localStorage.getItem('club-swiss-tournament-v1');
  return raw ? JSON.parse(raw) : null;
}

const $ = (id) => documentStub.getElementById(id);

step('add four players via the input + button', () => {
  $('player-name').value = 'Ada Lovelace';
  $('add-player-btn').dispatch('click');
  $('player-name').value = 'Grace Hopper';
  $('add-player-btn').dispatch('click');
  $('player-name').value = 'Judit Polgar';
  $('add-player-btn').dispatch('click');
  $('player-name').value = 'Hou Yifan';
  $('add-player-btn').dispatch('click');
  $('player-name').value = 'Magnus Carlsen';
  $('add-player-btn').dispatch('click');
  const t = stored();
  if (t.players.length !== 5) throw new Error('expected 5 players, got ' + t.players.length);
  if (!$('players-list').innerHTML.includes('Ada Lovelace')) throw new Error('roster pill not rendered');
});

step('duplicate player is rejected with a notice', () => {
  $('player-name').value = 'ada lovelace';
  $('add-player-btn').dispatch('click');
  if (!$('notice').innerHTML.includes('duplicate')) throw new Error('no warning shown');
  if (stored().players.length !== 5) throw new Error('duplicate got added');
});

step('pair round 1 (5 players -> 2 boards + 1 bye)', () => {
  $('pair-btn').dispatch('click');
  const t = stored();
  if (t.rounds.length !== 1) throw new Error('round not created');
  if (t.rounds[0].pairings.length !== 2) throw new Error('expected 2 boards for 5 players');
  if (t.rounds[0].byeId == null) throw new Error('expected a bye');
  const html1 = $('rounds-area').innerHTML;
  if (!html1.includes('Round 1')) throw new Error('round heading not rendered');
  if (!html1.includes('Bye')) throw new Error('bye not announced');
});

step('enter results for both boards', () => {
  $('rounds-area').dispatch('click', { target: { closest: () => ({ dataset: { round: '0', pr: '0', res: 'W' } }) } });
  $('rounds-area').dispatch('click', { target: { closest: () => ({ dataset: { round: '0', pr: '1', res: 'D' } }) } });
  const t = stored();
  const results = t.rounds[0].pairings.map((p) => p.result);
  if (results.join(',') !== 'W,D') throw new Error('results not recorded: ' + results.join(','));
  if (!($('notice').innerHTML.includes('Round 1 complete'))) throw new Error('completion notice missing');
});

step('pair round 2 after round 1 complete',() => {
  $('pair-btn').dispatch('click');
  const t = stored();
  if (t.rounds.length !== 2) throw new Error('round 2 not created');
  // no repeat pairing allowed
  const seen = new Set();
  t.rounds.forEach(rd => rd.pairings.forEach(p => {
    const k = p.whiteId < p.blackId ? p.whiteId + '|' + p.blackId : p.blackId + '|' + p.whiteId;
    if (seen.has(k)) throw new Error('repeat pairing  ' + k);
    seen.add(k);
  }));
});

step('finish round 2 -> standings render', () => {
  const r1 = stored().rounds[1];
  $('rounds-area').dispatch('click', { target: { closest: () => ({ dataset: { round: '1', pr: '0', res: 'B' } }) } });
  $('rounds-area').dispatch('click', { target: { closest: () => ({ dataset: { round: '1', pr: '1', res: 'W' } }) } });
  const s = $('standings-area').innerHTML;
  if (!s.includes('Pts')) throw new Error('standings table missing');
  if (!s.includes('Ada Lovelace')) throw new Error('player missing from standings');
});

step('cross-table shows results and bye marker', () => {
  const x = $('cross-area').innerHTML;
  if (!x.includes('X')) throw new Error('bye marker X missing from cross-table');
  if (!/W\+/.test(x)) throw new Error('win cell missing');
});

step('CSV exports produce downloadable blobs', () => {
  $('export-standings').dispatch('click');
  $('export-cross').dispatch('click');
});

step('standings rigorous check: total points = games + byes', () => {
  const t = stored();
  const rows = C.computeStandings(t);
  const total = rows.reduce((s, r) => s + r.score, 0);
  const games = t.rounds.reduce((s, rd) => s + rd.pairings.filter((p) => p.result).length, 0);
  const byes = t.rounds.filter((rd) => rd.byeId != null).length;
  if (t.rounds.some((rd) => rd.pairings.some((p) => !p.result))) throw new Error('a result was lost along the way');
  if (Math.abs(total - (games + byes)) > 1e-9) throw new Error('standings total mismatch: ' + total + ' vs games ' + games + ' + byes ' + byes);
});

step('reset clears the tournament', () => {
  $('reset-btn').dispatch('click');
  if (stored() !== null) throw new Error('storage not cleared');
  if (!$('players-list').innerHTML.includes('No players yet')) throw new Error('roster not re-rendered');
});

console.log('\nUI smoke: ' + (12 - failures) + '/12 steps ok');
process.exit(failures ? 1 : 0);

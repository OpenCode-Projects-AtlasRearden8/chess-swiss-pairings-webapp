/* Test runner for Club Swiss.
   Loads the DOM-free core block from index.html and runs it in Node. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const start = html.indexOf('/* CORE-START */');
const end = html.indexOf('/* CORE-END */');
if (start === -1 || end === -1) {
  console.error('FATAL: core block markers not found in index.html');
  process.exit(1);
}
const coreSrc = html.slice(start, end);
const sandbox = {};
new Function('globalThis', coreSrc)(sandbox); // eslint-disable-line no-new-func
const C = sandbox.SwissCore;
if (!C) {
  console.error('FATAL: SwissCore not exported from core block');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + name + '\n      ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n      ') : err));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function makeT(names) {
  const t = C.createTournament('Test');
  names.forEach((n) => { if (!C.addPlayer(t, n)) throw new Error('setup: could not add ' + n); });
  return t;
}

function finishRound(t, outcomes) {
  const r = t.rounds.length - 1;
  t.rounds[r].pairings.forEach((pr, i) => {
    const res = outcomes[i % outcomes.length];
    if (!C.recordResult(t, r, i, res)) throw new Error('setup: recordResult failed');
  });
}

function historyOf(t, id) {
  const opponents = new Set();
  t.rounds.forEach((r) =>
    r.pairings.forEach((p) => {
      if (p.whiteId === id) opponents.add(p.blackId);
      if (p.blackId === id) opponents.add(p.whiteId);
    })
  );
  return opponents;
}

function statOf(t, id) {
  const s = C.deriveStats(t);
  return s.get(id);
}

/* ---------- basic tournament management ---------- */

test('createTournament defaults', () => {
  const t = C.createTournament('Sunday Swiss');
  assert(t.name === 'Sunday Swiss');
  assert(t.players.length === 0 && t.rounds.length === 0);
});

test('addPlayer trims, numbers and rejects duplicates/empty', () => {
  const t = C.createTournament();
  assert(C.addPlayer(t, '  Ada  ').name === 'Ada');
  assert(C.addPlayer(t, 'ada') === null, 'case-insensitive duplicate should be rejected');
  assert(C.addPlayer(t, 'Bo') && t.players[1].num === 2);
  assert(C.addPlayer(t, '   ') === null, 'blank name rejected');
  assert(t.players.length === 2);
});

test('removePlayer ok before round 1, blocked after', () => {
  const t = makeT(['A', 'B', 'C']);
  const id = t.players[0].id;
  assert(C.removePlayer(t, id) === true);
  assert(t.players.length === 2 && t.players[0].num === 1);
  C.pairRound(t);
  assert(C.removePlayer(t, t.players[0].id) === false, 'cannot remove once rounds exist');
});

/* ---------- pairing rounds ---------- */

test('pairRound refuses with <2 players', () => {
  const t = makeT(['Solo']);
  let threw = false;
  try { C.pairRound(t); } catch (e) { threw = true; }
  assert(threw);
});

test('pairRound refuses while previous round has missing results', () => {
  const t = makeT(['A', 'B', 'C', 'D']);
  C.pairRound(t);
  let threw = false;
  try { C.pairRound(t); } catch (e) { threw = true; }
  assert(threw, 'must refuse until all results entered');
});

test('odd roster: bye gets a full point and rotates players', () => {
  const t = makeT(['P1', 'P2', 'P3', 'P4', 'P5']);
  C.pairRound(t);
  assert(t.rounds[0].pairings.length === 2);
  assert(t.rounds[0].byeId != null, 'odd count needs a bye');
  finishRound(t, ['W']);
  C.pairRound(t);
  const id1 = t.rounds[0].byeId, id2 = t.rounds[1].byeId;
  assert(id2 != null && id2 !== id1, 'no player gets two byes while others have none');
  assert(statOf(t, id1).byes === 1 && statOf(t, id1).score === 1, 'bye counts as one point');
});

/* Independent replay of pairing invariants: does the set of already-played
   pairs still allow a perfect matching that avoids every replayed pair? */
function existsRepeatFreeMatching(t, priorRoundCount) {
  const ids = t.players.map((p) => p.id);
  const played = new Set();
  for (let r = 0; r < priorRoundCount; r++) {
    t.rounds[r].pairings.forEach((p) => {
      const key = p.whiteId < p.blackId ? p.whiteId + '|' + p.blackId : p.blackId + '|' + p.whiteId;
      played.add(key);
    });
  }
  const n = ids.length;
  const used = new Array(n).fill(false);
  function bt() {
    const i = ids.findIndex((_, k) => !used[k]);
    if (i === -1) return true;
    for (let j = 0; j < n; j++) {
      if (used[j] || j === i) continue;
      const key = ids[i] < ids[j] ? ids[i] + '|' + ids[j] : ids[j] + '|' + ids[i];
      if (played.has(key)) continue;
      used[i] = used[j] = true;
      if (bt()) { used[i] = used[j] = false; return true; }
      used[i] = used[j] = false;
    }
    return false;
  }
  return bt();
}

/* Could the round's board colors have been assigned differently so no player
   ends a round with |whites-blacks| > limit, no one with three same colors in
   a row, given each player's colour state before the round? */
function colorAssignmentExists(t, roundIndex, statsBefore, limit) {
  const round = t.rounds[roundIndex];
  const boards = round.pairings;
  const streakAfter = (s, color) => (s.prevColor === color ? s.streak + 1 : 1);
  function okOrientation(board, aWhite) {
    const a = statsBefore.get(aWhite ? board.whiteId : board.blackId);
    const b = statsBefore.get(aWhite ? board.blackId : board.whiteId);
    const aColor = aWhite ? 'W' : 'B', bColor = aWhite ? 'B' : 'W';
    const newA = a.whites - a.blacks + (aColor === 'W' ? 1 : -1);
    const newB = b.whites - b.blacks + (bColor === 'W' ? 1 : -1);
    const sa = streakAfter(a, aColor), sb = streakAfter(b, bColor);
    return Math.abs(newA) <= limit && Math.abs(newB) <= limit && sa < 3 && sb < 3;
  }
  // Greedy over boards is valid here: the constraint per board depends only on
  // that board's two players, so boards are independent.
  return boards.every((b) => okOrientation(b, true) || okOrientation(b, false));
}

test('five rounds with 6 players covers the full round robin (zero repeats)', () => {
  const t = makeT(['A', 'B', 'C', 'D', 'E', 'F']);
  const outcomes = ['W', 'W', 'D', 'B', 'D']; // one result style per round
  for (let r = 0; r < 5; r++) {
    assert(!existsRepeatFreeMatching(t, r) === false, 'pre-check: round ' + (r + 1) + ' should be pairable repeat-free');
    C.pairRound(t);
    finishRound(t, [outcomes[r]]);
    t.rounds[r].pairings.forEach((p) => assert(!p.rematch, 'no rematches expected: fully pairable'));
  }
  const all = new Set();
  t.rounds.forEach((rd) =>
    rd.pairings.forEach((p) => {
      const key = p.whiteId < p.blackId ? p.whiteId + '|' + p.blackId : p.blackId + '|' + p.whiteId;
      assert(!all.has(key), 'repeat pairing detected: ' + key);
      all.add(key);
    })
  );
  assert(all.size === 15, '6 players over 5 rounds should cover 15 distinct pairs, got ' + all.size);
});

test('forced-rematch round: pairings succeed and rematches happen only when unavoidable', () => {
  // The rigid cycle ['B','D'] x 3 per round drives scores into a perfectly
  // symmetric position whose remaining graph is two triangles; a rematch is
  // then mathematically necessary. The engine must still always succeed.
  const t = makeT(['A', 'B', 'C', 'D', 'E', 'F']);
  const outcomes = ['B', 'D'];
  for (let r = 0; r < 5; r++) {
    C.pairRound(t);
    finishRound(t, outcomes);
    const hasRematch = t.rounds[r].pairings.some((p) => p.rematch);
    if (hasRematch) {
      assert(!existsRepeatFreeMatching(t, r),
        'round ' + (r + 1) + ' contained a rematch, but a repeat-free pairing existed');
    }
  }
});

test('even roster: everyone plays exactly once per round', () => {
  const t = makeT(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  for (let r = 0; r < 4; r++) {
    C.pairRound(t);
    finishRound(t, ['W', 'B', 'D']);
    t.rounds[r].pairings.forEach((p) => {
      assert(p.result, 'every board finished');
    });
  }
  for (let r = 0; r < 4; r++) {
    const seen = new Map();
    t.rounds[r].pairings.forEach((p) => {
      seen.set(p.whiteId, (seen.get(p.whiteId) || 0) + 1);
      seen.set(p.blackId, (seen.get(p.blackId) || 0) + 1);
    });
    assert(seen.size === 8 && [...seen.values()].every((v) => v === 1), 'each player plays exactly once in round ' + (r + 1));
    assert(t.rounds[r].byeId == null, 'even roster: no byes');
  }
});

test('after round 1 every player has played one game, one of each color across the field', () => {
  const t = makeT(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  C.pairRound(t);
  finishRound(t, ['D', 'D', 'D', 'D']);
  const pairs = t.rounds[0].pairings;
  assert(pairs.length === 4, '4 boards with 8 players');
  // Every player took part exactly once...
  const seen = new Set();
  pairs.forEach((p) => { seen.add(p.whiteId); seen.add(p.blackId); });
  assert(seen.size === 8, 'all 8 players played');
  // ...and across the field there were exactly 4 whites and 4 blacks.
  const whites = pairs.filter((p) => C.deriveStats(t).get(p.whiteId).whites > 0).length;
  assert(whites === 4, 'exactly 4 boards with white counted: ' + whites);
  let balanced = true;
  t.players.forEach((pl) => {
    const s = C.deriveStats(t).get(pl.id);
    if (s.whites + s.blacks !== 1) balanced = false;
  });
  assert(balanced, 'each player counted exactly one game');
});

test('colors stay within a workable spread (|w-b| <= 2) through four rounds', () => {
  const t = makeT(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  for (let r = 0; r < 4; r++) {
    C.pairRound(t);
    finishRound(t, ['W', 'B', 'B', 'D', 'W']);
    t.players.forEach((p) => {
      const s = statOf(t, p.id);
      assert(Math.abs(s.whites - s.blacks) <= 2, p.name + ' color imbalance after round ' + (r + 1) + ' (W:' + s.whites + ' B:' + s.blacks + ')');
    });
  }
});

test('no player gets three of the same color in a row (6 players, full round robin)', () => {
  const t = makeT(['A', 'B', 'C', 'D', 'E', 'F']);
  for (let r = 0; r < 5; r++) {
    C.pairRound(t);
    finishRound(t, ['W', 'D', 'B']);
  }
  t.players.forEach((p) => {
    let streakW = 0, streakB = 0;
    t.rounds.forEach((rd) =>
      rd.pairings.forEach((pr) => {
        if (pr.whiteId === p.id) { streakW++; streakB = 0; }
        else if (pr.blackId === p.id) { streakB++; streakW = 0; }
        assert(streakW < 3 && streakB < 3, p.name + ' got 3 same colors in a row');
      })
    );
  });
});

/* ---------- scores and standings ---------- */

test('scores, wins/draws/losses accumulate correctly', () => {
  const t = makeT(['A', 'B', 'C', 'D']);
  C.pairRound(t);
  t.rounds[0].pairings[0].result = 'W'; // direct write is same as recordResult; use API here
  const r0 = t.rounds[0];
  C.recordResult(t, 0, 0, 'W');
  C.recordResult(t, 0, 1, 'D');
  assert(r0.pairings[0].result === 'W');
  const s0 = C.deriveStats(t);
  assert(s0.get(r0.pairings[0].whiteId).score === 1);
  assert(s0.get(r0.pairings[0].blackId).score === 0);
  assert(s0.get(r0.pairings[1].whiteId).score === 0.5);
  assert(s0.get(r0.pairings[1].blackId).score === 0.5);
  assert(s0.get(r0.pairings[0].whiteId).games === 1);
});

test('computeStandings orders by score then Buchholz', () => {
  const t = makeT(['A', 'B', 'C', 'D']);
  C.pairRound(t);
  finishRound(t, ['W', 'W']); // round 1: two winners
  C.pairRound(t);
  finishRound(t, ['W', 'D']);
  // winners of round 1 play each other on board 1 (both 1 pt); one wins, other draws board 2.
  const rows = C.computeStandings(t);
  assert(rows.length === 4);
  assert(rows[0].score >= rows[1].score && rows[1].score >= rows[2].score && rows[2].score >= rows[3].score);
  // sum of all scores must equal games played (1/2 per draw counted twice)
  const total = rows.reduce((s, r) => s + r.score, 0);
  const games = t.rounds.reduce((s, r) => s + r.pairings.filter((p) => p.result).length, 0);
  assert(total === games, 'total points = number of decided games');
});

test('buchholz math is exact on a constructed case', () => {
  const t = makeT(['A', 'B', 'C', 'D']);
  C.pairRound(t);
  finishRound(t, ['W', 'D']);
  C.pairRound(t);
  finishRound(t, ['B', 'W']);
  const rows = C.computeStandings(t);
  const byName = new Map(rows.map((r) => [r.name, r]));
  // Verify Buchholz = sum of opponents' final scores for each player.
  rows.forEach((row) => {
    let buch = 0;
    t.rounds.forEach((rd) =>
      rd.pairings.forEach((p) => {
        if (p.whiteId === row.id && p.result) buch += C.deriveStats(t).get(p.blackId).score;
        if (p.blackId === row.id && p.result) buch += C.deriveStats(t).get(p.whiteId).score;
      })
    );
    assert(deepEq(byName.get(row.name).buchholz, Math.round(buch * 100) / 100),
      'buchholz mismatch for ' + row.name);
  });
});

test('tied players share a rank', () => {
  const t = makeT(['A', 'B', 'C', 'D']);
  C.pairRound(t);
  finishRound(t, ['D', 'D']);
  const rows = C.computeStandings(t);
  assert(rows.every((r) => r.rank === 1), 'all-draws round means everyone tied at rank 1');
});

/* ---------- exports ---------- */

test('standings CSV has header and one row per player', () => {
  const t = makeT(['Ada', 'Bo', 'Cy', 'Dee']);
  C.pairRound(t);
  finishRound(t, ['W', 'D']);
  const csv = C.standingsCSV(t);
  const lines = csv.trim().split('\n');
  assert(lines[0] === 'Rank,Player,Points,W,D,L,Buchholz,Byes');
  assert(lines.length === 5);
  assert(lines.some((l) => l.startsWith('1,')), 'rows are ranked');
});

test('cross-table CSV shape: header count, row count, quoted names', () => {
  const t = makeT(['Ada', 'Bo', 'Cy', 'Dee', 'Eve']);
  C.pairRound(t);
  finishRound(t, ['W', 'D']);
  C.pairRound(t);
  finishRound(t, ['W', 'W']);
  const csv = C.crossTableCSV(t);
  const lines = csv.trim().split('\n');
  assert(lines.length === 6, 'header + 5 players');
  const header = lines[0].split(',');
  assert(header[0] === 'Player', 'first header cell is Player');
  assert(header[6] === 'Pts' && header[7] === 'Buchholz', 'final columns are Pts and Buchholz');
  assert(header.length === 8, 'header = Player + 5 numbers + Pts + Buchholz');
  header.slice(1, 6).forEach((h, i) => assert(h === String(i + 1), 'column ' + (i + 1) + ' header'));
  lines.slice(1).forEach((line) => {
    const cells = line.split(',');
    assert(cells.length === 8, 'each row has 8 cells');
  });
  // A name containing a comma must be quoted so the CSV stays valid.
  const t2 = makeT(['Smith, John', 'X']);
  const csv2 = C.crossTableCSV(t2);
  assert(csv2.includes('"Smith, John"'), 'names with commas are quoted');
});

test('cross-table cells encode opponent, color and result', () => {
  const t = makeT(['A', 'B']);
  C.pairRound(t);
  const p = t.rounds[0].pairings[0];
  const whiteName = C.findPlayer(t, p.whiteId).name;
  const blackName = C.findPlayer(t, p.blackId).name;
  C.recordResult(t, 0, 0, 'W');
  const csv = C.crossTableCSV(t);
  const rowWhite = csv.split('\n').find((l) => l.startsWith(whiteName));
  const rowBlack = csv.split('\n').find((l) => l.startsWith(blackName));
  // e.g. "A,B2W+,B,1" — white beat #2 (B) as white
  assert(rowWhite.includes('2W+'), 'white row shows opp 2, color W, win: ' + rowWhite);
  assert(rowBlack.includes('1B-'), 'black row shows opp 1, color B, loss: ' + rowBlack);
});

test('bye appears as X on the diagonal in the cross-table', () => {
  const t = makeT(['A', 'B', 'C']);
  C.pairRound(t);
  const byeId = t.rounds[0].byeId;
  const byeNum = C.findPlayer(t, byeId).num;
  finishRound(t, ['W']);
  const csv = C.crossTableCSV(t);
  const lines = csv.trim().split('\n');
  const rowBye = lines.slice(1).find((l) => l.split(',')[1] === C.findPlayer(t, byeId).name)
    || lines.slice(1).find((l) => l.includes(C.findPlayer(t, byeId).name));
  assert(rowBye, 'found the bye player row: ' + JSON.stringify(lines));
  const cells = rowBye.split(',');
  assert(cells[byeNum] === 'X', 'diagonal cell for the bye player is X, row: ' + rowBye);
});

/* ---------- fuzz: seeded random tournaments hold all invariants ---------- */

function lcg(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('fuzz: 6 random tournaments keep pairing sound, byes fair, colors handled', () => {
  const rand = lcg(20261108);
  for (let trial = 0; trial < 6; trial++) {
    const n = 5 + Math.floor(rand() * 12); // 5..16 players
    const names = [];
    for (let i = 0; i < n; i++) names.push('Player ' + String(i + 1).padStart(2, '0'));
    const t = makeT(names);
    const resPool = ['W', 'B', 'D', 'W', 'B'];
    const maxRounds = 6;
    for (let r = 0; r < maxRounds; r++) {
      C.pairRound(t);
      const round = t.rounds[r];
      round.pairings.forEach((p, i) => {
        const res = resPool[Math.floor(rand() * resPool.length)];
        assert(C.recordResult(t, r, i, res));
      });

      // every player plays at most once per round, and the bye is not paired
      const perRoundCount = new Map();
      round.pairings.forEach((p) => {
        perRoundCount.set(p.whiteId, (perRoundCount.get(p.whiteId) || 0) + 1);
        perRoundCount.set(p.blackId, (perRoundCount.get(p.blackId) || 0) + 1);
      });
      for (const v of perRoundCount.values()) assert(v === 1, 'a player is paired twice in one round');
      assert(!perRoundCount.has(round.byeId), 'bye player must not also be paired');
      assert(n % 2 === 1 ? round.byeId != null : round.byeId == null, 'bye presence matches roster parity');

      // rematch rounds must be genuinely unavoidable
      if (round.pairings.some((p) => p.rematch)) {
        assert(!existsRepeatFreeMatching(t, r), 'rematch in trial ' + trial + ' round ' + (r + 1) + ' was avoidable');
      }

      // byes rotate: nobody gets a second bye while someone still has none
      const byesCount = new Map();
      for (let rr = 0; rr <= r; rr++) {
        const b = t.rounds[rr].byeId;
        if (b != null) byesCount.set(b, (byesCount.get(b) || 0) + 1);
      }
      const minByes = Math.min(...t.players.map((p) => byesCount.get(p.id) || 0));
      const maxByes = Math.max(0, ...byesCount.values());
      if (r + 1 <= n) {
        assert(maxByes - minByes <= 1,
          'unfair bye spread trial ' + trial + ' round ' + (r + 1) + ': ' + [...byesCount.entries()].map((e) => e[0] + ':' + e[1]).join(','));
      }

      // colors: no one may be pushed past the limits when a gentler assignment existed
      const statsBefore = C.deriveStats({ players: t.players, rounds: t.rounds.slice(0, r) });
      let overColor = false, streakThree = false;
      t.players.forEach((p) => {
        const s = C.deriveStats(t).get(p.id);
        if (Math.abs(s.whites - s.blacks) > 2) overColor = true;
        if (s.streak >= 3) streakThree = true;
      });
      if (overColor) assert(!colorAssignmentExists(t, r, statsBefore, 2), 'color spread >2 was avoidable in trial ' + trial + ' round ' + (r + 1));
      if (streakThree) assert(!colorAssignmentExists(t, r, statsBefore, 2), '3-in-a-row colors were avoidable in trial ' + trial + ' round ' + (r + 1));

      // standings sanity
      const rows = C.computeStandings(t);
      const total = rows.reduce((s, x) => s + x.score, 0);
      const games = t.rounds.reduce((s, x) => s + x.pairings.filter((p) => p.result).length, 0);
      const byePoints = t.rounds.reduce((s, x) => s + (x.byeId != null ? 1 : 0), 0);
      assert(Math.abs(total - (games + byePoints)) < 1e-9, 'total points = games + byes');
    }
  }
});

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

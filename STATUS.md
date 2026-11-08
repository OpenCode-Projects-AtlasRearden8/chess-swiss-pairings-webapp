# STATUS.md

## What was built

**Club Swiss** — a single-file, static web app for running a small Swiss-style
chess tournament at a chess club. No server, no dependencies, no build step:
open `index.html` in any modern browser and everything works offline.

Features:

- **Player entry** — add players one at a time or paste a comma-separated
  list; duplicate-proof; players can be removed up until Round 1 is paired.
- **Round pairing** — classic Swiss pairing: score groups, Dutch-style fold
  (top half vs. bottom half), float-downs when a group is odd, group merging
  as a fallback. Opponents never repeat unless mathematically impossible
  (rounds beyond full round-robin capacity); forced rematches get a visible
  "rematch" chip and only appear where a brute-force check in the tests
  proves no repeat-free pairing existed.
- **Boards & colors** — boards numbered top-down, colors assigned to balance
  whites/blacks per player and avoid three-same-colors-in-a-row, with
  down-board alternation as the tie-break.
- **Results entry** — one click per board (`1–0`, `½–½`, `0–1`); the next
  round can't be paired until every board is filled.
- **Byes** — odd rosters get one full-point bye per round; goes to the
  lowest-scored player who hasn't had one yet, so it rotates fairly.
- **Standings** — points, W/D/L, Buchholz tiebreak (sum of opponents'
  scores), shared ranks on real ties.
- **Cross-table** — player-vs-player grid (`2W+` = beat opponent #2 as
  white; `X` on the diagonal for byes) plus CSV export for the cross-table
  and standings.
- **Auto-save** — tournament state persists in `localStorage` after every
  action; "Start over" clears it with confirmation.

## How to run it

Open `index.html` in a browser. That's it.

Run the test suites with Node (no dependencies):

```bash
node tests/run-tests.mjs   # core pairing logic: 21 tests incl. fuzz
node tests/ui-smoke.mjs    # UI flows against a stub DOM: 12 steps
```

## How it's structured

- `index.html` — everything: styling, DOM-free core logic (between
  `/* CORE-START */` / `/* CORE-END */` markers so tests can extract it),
  and the UI layer below it.
- `tests/run-tests.mjs` — loads the core block directly from `index.html`
  and runs unit tests plus fuzzed tournaments with an independent
  brute-force verifier for rematch forcedness and color feasibility.
- `tests/ui-smoke.mjs` — stubs the DOM and drives the real UI handlers.

## Verification results

- `node tests/run-tests.mjs` → **21 passed, 0 failed**
- `node tests/ui-smoke.mjs` → **12/12 steps ok**
- Extra stress run (not part of the suite): 40 seeded random tournaments,
  4–23 players, up to 9 rounds = **360 rounds paired with zero engine
  failures and zero avoidable rematches.**

Bugs found and fixed during verification:

1. Black-win results double-credited white/black color counts (corrupted
   color balancing from round 2 on).
2. A greedy global matcher could leave two odd cycles unmatchable (dead
   end, pairing thrown away); replaced with score-group pairing + floats +
   merging + a verified minimal-rematch fallback.
3. Bye selection could give one player two byes while others had none;
   byes are now pre-selected (lowest score, no prior bye, lowest rank)
   before pairing.
4. Newly added players were not saved to localStorage until the first
   pairing.

## Known gaps / accepted limitations

- **Swiss quality is club-grade, not FIDE-master-grade.** Rules simplified:
  no rating-based pairings, no ½-point or zero-point pairing requests, no
  accelerated pairings, no arbitration for DNF/withdrawals mid-tournament,
  no color-preference direction rule (White/Black "due" counts only).
- **Rematches beyond capacity are round-local:** a rematch appears only in
  rounds where no repeat-free pairing existed *given the actual history*;
  the engine can't see two rounds ahead, so an earlier-round choice made by
  the algorithm may occasionally force a later rematch where perfect
  foresight would not.
- **Color counts may drift to |W−B| = 2** in forced-conflict rounds (two
  players both due the same color meeting), consistent with club practice;
  the tests verify better assignments were not available.
- **localStorage on `file://`** works in Chrome/Firefox; some browsers'
  private modes silently disable it (an empty-tournament restart is the
  graceful failure mode). CSV downloads are unaffected and work everywhere.
- **No print stylesheet** — the tables are readable when printing via the
  browser's default print dialog, but a dedicated print layout is future
  work.
- Distinct from sibling projects: this manages *standings and pairings*,
  not over-the-board play or printable kits.

## Author

Made by Asdale Dynamics, LLC — friendly, practical, local-first tools.
MIT licensed (`LICENSE`).

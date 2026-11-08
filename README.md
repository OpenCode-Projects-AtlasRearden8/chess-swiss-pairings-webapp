# Club Swiss

A single-file helper for running a small Swiss-style chess tournament at your
club. Open it in a browser, enter your players, and it pairs every round,
track boards and colors, take results, and build standings — no accounts, no
server, nothing leaves your browser.

Written in plain English style for real-world club volunteers, not download
chess engines: it pairs rounds the way most club organizers do — strongest
players against equal scores, no repeats, colors alternating, byes rotating.

## How to run it

No build step, no install:

1. Double-click `index.html` (or open it in any modern browser).
2. Type your players (one name at a time, or paste a comma-separated list).
3. Click **Pair round 1**, then fill in each board's result
   (`1–0`, `½–½`, `0–1`).
4. When every board has a result, click **Pair round 2** — and repeat.
5. Watch the standings and cross-table build automatically as rounds finish.
6. Download **standings CSV** or **cross-table CSV** for your club newsletter
   or records.

Your tournament is saved in the browser's local storage automatically, and
*Start over* clears everything (with a confirmation).

## What it does behind the scenes

- **Pairings avoid repeats.** Players in the same score group are paired
  first (highest vs. middle, folding down the half), with floaters swapped
  into neighboring groups the classic way. Nobody plays the same opponent
  twice unless the mathematics of your roster forces it — and in that rare
  case, the round is marked with a "rematch" chip.
- **Colors alternate** — the tool tracks who has had white and black, and
  tries to keep every player's count close to even, with no three-in-a-row
  runs unless unavoidable.
- **Byes rotate.** An odd roster means one player sits out each round with a
  full-point bye (byes count as 1). The lowest-scored player who hasn't had a
  bye yet gets the next one, so everyone shares the load fairly.
- **Standings** use score, then Buchholz (sum of opponents' scores), then
  win count, with shared ranks for real ties.
- **The cross-table** is a grid of every player versus every other player,
  where each cell shows opponent number, color played, and result
  (`2W+` means "beat opponent #2 as white"). Byes show as an X.

## Testing

The pairing logic is DOM-free and covered by a Node test suite:

```bash
node tests/run-tests.mjs     # tournament-logic tests, including fuzzed tournaments
node tests/ui-smoke.mjs      # UI flow smoke tests against a stub DOM
```

Both must pass; they run in about a second with zero dependencies.

## Privacy & licensing

- Everything runs locally; no data is ever sent anywhere. Nothing to
  configure, nothing to trust but your own browser.
- Released under the MIT License.
- Made by [Asdale Dynamics, LLC](https://dylanasdale.github.io) — practical,
  friendly tools that respect your attention and your data.

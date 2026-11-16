# Token Radar — a fitted value curve, tested blind, netted to dollars

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/reyxnal/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/reyxnal/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A make.fun `token-radar-01` entry: a radar that ranks every pre-token protocol in the sealed
snapshot by an implied launch value, tests the curve behind the ranking out of sample, nets
every farm plan to dollars at the low end of the curve's own uncertainty band, and gives each
protocol an eight-step farm plan with costs and times.

Contest: [token-radar-01 — $1,325 USDC bounty](https://make.fun/c/token-radar-01).

## The model (radar-3)

Implied value is computed from the snapshot's own figures — no protocol name is special-cased:

```
implied = round( curve_base x category_shift x growth x maturity x breadth )
curve_base = 10 ^ (intercept + slope x log10(tvl_usd))
```

- **curve** — an OLS fit of log10(market cap) on log10(TVL) over the snapshot's live-token
  comps. Market cap grows slower than TVL (slope 0.522 on this snapshot), so a flat mcap/TVL
  multiple would overvalue the biggest protocols.
- **category_shift** — the median log residual inside the category, pulled toward zero with
  weight 3 (empirical-Bayes-style shrinkage), so small categories borrow the curve; 1 when the
  category has fewer than 3 live protocols or is unrecorded.
- **growth** — `1 + clamp(change_7d, -60, 120) / 100 x 0.5`.
- **maturity** — `0.6 + min(age_days, 1095) / 1095 x 0.4`; unknown age counts as 365 days.
- **breadth** — `1 + 0.05` per extra chain, capped at 1.20.

The board carries the whole watchlist (40 protocols) plus every rankable pre-token protocol
below the $50M floor — 226 rows on this snapshot. The live-token protocols are set aside with
their market caps shown, so the board never confuses a market price with a model estimate.

## Blind validation

The curve is fitted on a subset and scored on protocols it never saw, under three split
schemes. Median absolute log10 error (lower is better) and hit rate within 2×, on the
2026-11-14 snapshot:

| Scheme | Full model | Curve only | Power law | Global median |
|---|---|---|---|---|
| Leave-one-out (n=128) | 0.60 · 31% | 0.56 · 32% | 0.53 · 32% | 0.71 · 28% |
| Random 70/30 (seed 20261114) | 0.59 · 23% | 0.59 · 26% | 0.62 · 23% | 0.79 · 18% |
| Time split (cutoff 2024-02-18) | 0.52 · 29% | 0.48 · 35% | 0.48 · 35% | 0.72 · 23% |

The full model beats the global-median baseline on every scheme. The uncertainty band comes
from the full model's leave-one-out error: band ×3.96, so the low end of the band is
implied ÷ 3.96. Rank ranges on the board are 90% bootstrap intervals from 200 refits of the
curve (same seed, same ranges, every run).

## Farm economics

Every row is netted to dollars at the low end of the band, under assumptions stated on the
page: the farmer's share is 0.001% of fully diluted value (a 10% airdrop pool shared by 10,000
qualifying wallets), time is worth $15 an hour, and the alternative is a 4.5% T-bill over the
hold period. Gas and time are the amounts the farm steps name. The verdict is **farm** when
the low-end value covers the cost twice over, **thin** when the net is positive but below that
margin, and **skip** when the net is zero or worse, or loses to the T-bill. On this snapshot:
1 farm · 5 thin · 220 skip — the radar's value is the short list.

## The dashboard

A static page (no framework, no network) in `dashboard/`: an evidence panel with the blind
validation table and a log-log chart of the curve against the live comps, a sortable,
filterable board (search, category, chain, watchlist-only, minimum TVL, verdict) with rank
ranges and verdicts, a per-protocol detail view with the model's own inputs, the farm
economics and the eight-step farm plan, a model sandbox that re-scores the board live when
you move a knob, and a category-benchmark panel showing the calibration itself. The page
recomputes every row with the same function as `lib/model.ts` and says whether it matches
`board.json` (226/226 on this snapshot, values and economics alike).

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22+, standard library only. Output: `board.json`, `data.js`, `dashboard/`, `screenshots/`,
`dossier.json`. Run twice and diff the outputs: the build is deterministic.

## Layout

- `main.ts` — reads the snapshot, scores it, writes the board and the dossier.
- `lib/model.ts` — the radar-3 model, the blind validation, the bootstrap ranges, the farm
  economics, the farm plans and the snapshot parser.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`).
- `vendor/makefun-board.ts` — the vendored make.fun dossier builder (unmodified).
- `screenshots/` — the three dossier screenshots: the board, a detail view, a filtered view.

# Token Radar — category-calibrated implied values

A make.fun `token-radar-01` entry: a radar that ranks every pre-token protocol in the sealed
snapshot by an implied value, and gives each one an eight-step farm plan with costs and times.

## The model (radar-2)

Implied value is computed from the snapshot's own figures — no protocol name is special-cased:

```
implied = round( tvl_usd x category_multiple x growth x maturity x breadth )
```

- **category_multiple** — the median mcap/TVL of the snapshot's live-token protocols in that
  category, shrunk toward the global median (weight 3), so small categories borrow the market rate.
- **growth** — `1 + clamp(change_7d, -60, 120) / 100 x 0.5`.
- **maturity** — `0.6 + min(age_days, 1095) / 1095 x 0.4`; unknown age counts as 365 days.
- **breadth** — `1 + 0.05` per extra chain, capped at 1.20.

The board carries the whole watchlist (40 protocols) plus every rankable pre-token protocol
below the $50M floor — 226 rows on this snapshot. The live-token protocols are set aside with
their market caps shown, so the board never confuses a market price with a model estimate.

## The dashboard

A static page (no framework, no network) in `dashboard/`: a sortable, filterable board
(search, category, chain, watchlist-only, minimum TVL), a per-protocol detail view with the
model's own inputs and the eight-step farm plan, a model sandbox that re-scores the board live
when you move a knob, and a category-benchmark panel showing the calibration itself. The page
recomputes every row with the same function as `lib/model.ts` and says whether it matches
`board.json`.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22+, standard library only. Output: `board.json`, `data.js`, `dashboard/`, `screenshots/`,
`dossier.json`. Run twice and diff the outputs: the build is deterministic.

## Layout

- `main.ts` — reads the snapshot, scores it, writes the board and the dossier.
- `lib/model.ts` — the radar-2 model, the farm plans and the snapshot parser.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`).
- `vendor/makefun-board.ts` — the vendored make.fun dossier builder (unmodified).
- `screenshots/` — the three dossier screenshots: the board, a detail view, a filtered view.

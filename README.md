# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/birruKN/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/birruKN/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have not launched a token yet, priced off the ones that have — and, in this version, honest about its own accuracy: the valuation curve is rehearsed blind on a held-out split of the market before it is allowed to price the board, and the rehearsal numbers are printed on the dashboard.

## Run it

```sh
node main.ts --input /input --output /output
```

`main.ts` reads a DefiLlama snapshot (`/input/snapshot.json`, or `--input <file|dir>`), ranks every
independent pre-token protocol it can defend, and writes `board.json`, `data.js`, a copy of
`dashboard/`, a copy of `screenshots/`, and `dossier.json` (built with `vendor/makefun-board.ts`)
to the output directory (`--output`, `MAKEFUN_OUTPUT_DIR`, or `/output`). Node 22+, standard
library only, no network. Two runs over the same snapshot write identical bytes.

## The valuation model — "comps-curve v3"

Everything is derived from the snapshot's own figures at run time; nothing is hard-coded per
protocol, and there are no fees or revenue fields in the snapshot, so none are claimed.

1. **Calibration.** A protocol counts as pre-token when the snapshot records no market cap, no
   Gecko id and no symbol for it. Of the tokenised protocols, the ones carrying both a market cap
   and a TVL form the calibration set (128 in the practice snapshot). A power law is fitted by
   least squares — `log10(mcap) = A + B * log10(TVL)` — with one 2.5-sigma clipping round and a
   refit (126 points survive: A = 2.6664, B = 0.5686, residual scatter 0.8403 dex). The slope under
   1 is the market's size discount: a token's multiple falls from about 0.44x TVL at $10M to about
   0.03x at $5B.
2. **Category adjustment.** Each category's median residual against the curve, shrunk by
   n/(n+6) and clamped to ±0.4 dex (needs at least 4 live members). Lending and liquid staking
   price below the curve; RWA, basis trading and cross-chain categories price above it.
3. **Per-protocol adjustments.** Momentum: `1 + 0.30 * clamp(change_7d, -40, +60)/100`.
   Maturity: `0.75 + 0.25 * min(age_days, 1095)/1095` — a protocol that has run for years with no
   token prices closer to the curve than a three-week-old one. Factors are rounded to the four
   decimals the dashboard prints before they price the row, so the detail view's own recompute
   lands on board.json's number to the dollar.
4. **Band.** Each row carries a one-sigma range (`implied / 10^0.8403` to `implied * 10^0.8403`):
   the spread across which the market actually prices comparable protocols.

## Tested blind — the held-out rehearsal

New in v3. Before the board is priced, the method has to survive a rehearsal it cannot peek at:
the calibration set is split by a fixed hash of each protocol's slug (bucket 0 of 5 is held out —
94 protocols fit, 34 are held out in the practice snapshot). The curve and category factors are
fitted on the fit split only, then both splits are priced under that blind fit and scored against
their recorded market caps. On the practice snapshot the rehearsal reports, computed at run time
and printed on the dashboard: median absolute error **0.60 dex held out vs 0.44 dex in sample**,
and ±1σ band coverage **67.7% held out vs 72.3% in sample**. The board itself is then priced from
the full fit — the dashboard says so plainly — but the reader can see exactly how much the method
degrades on data it never fitted, instead of taking the in-sample scatter on faith.

## Board membership

Every watchlist protocol (all 40), plus every other pre-token protocol that is an independent
launch candidate. Set aside, with reasons stated in the code: exchanges and exchange house brands
(their token, if any, is the venue's, not a farmable launch), bridge and staking infrastructure
categories, and versioned, wrapped or staked products of something that already trades. The
practice snapshot yields 198 rows: 40 watchlist, 20 more above the $50M floor, 138 early.

Each row carries a seven-step farm plan generated from the protocol's own category, first chain,
TVL (capital $25–$250) and age (a 30–60 day hold), with a cost and a time on every step.

## The dashboard

`dashboard/` is a self-contained page (no external references) rendered from `data.js`: a sortable,
filterable board (search, category, chain, tier), a live-comps tab showing the calibration set with
the market's own figures, a per-protocol detail view with the model's arithmetic, the
category's live comparables and the farm plan, and the blind-test panel with the rehearsal's
method and numbers. View state lives in the URL hash, so every view — including the four
screenshots — is reproducible from a link.

---

<sub>Entered on [make.fun](https://make.fun/?ref=4zccysyp&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

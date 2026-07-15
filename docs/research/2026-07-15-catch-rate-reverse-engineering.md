# Catch-rate reverse engineering (Poke Idle World)

**Status:** Phase 1 complete (ball structure). Phase 2 pending (value axis + field + saturation).
**Related:** `docs/superpowers/specs/2026-07-14-hunt-efficiency-design.md` (respawn/walk/spawn mechanics), `hunt_optimizer.html` (Captura & Gold/h tabs currently use the piwtools heuristic — to be replaced once Phase 2 lands).

## Method

The game server decides each catch attempt and reports it over the websocket as a
`catch-result` frame (`speciesName`, `ballName`, `ballId`, `success`, `auto`). With
auto-catch enabled the game throws exactly one ball per kill, so an AFK farming
session is a stream of Bernoulli trials (~600–900/hour depending on the hunt).
Sessions are captured with a console hook (WS + fetch + XHR with timestamps),
segmented per hunt via `enter-hunt` frames. Raw capture files contain the account
JWT and are never committed — only aggregate counts live in this repo.

Design: one account per (hunt, ball) cell, run in parallel. Models are fitted by
binomial maximum likelihood and compared by AIC / likelihood-ratio, with a
saturated-model deviance test for goodness of fit.

## Phase 1 — ball structure (2026-07-15)

Setup: 4 accounts, all on the **Abra** hunt (value 800), one ball each, ~1h each.
2,294 valid trials (2 stray "Idle Ball" throws discarded; one duplicated cumulative
download deduped by session timestamp).

| ball | price | game `catchRate` | trials | catches | observed | 95% CI |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Poké | 5 | 1 | 610 | 7 | 1.15% | 0.56–2.35% |
| Great | 20 | 2 | 543 | 19 | 3.50% | 2.25–5.40% |
| Super | 50 | 3 | 516 | 41 | 7.95% | 5.91–10.60% |
| Ultra | 130 | 4 | 625 | 126 | 20.16% | 17.20–23.48% |

Model comparison (binomial MLE over the 4 cells):

| model | params | ΔAIC | deviance (df) | verdict |
| --- | --- | ---: | --- | --- |
| `1 − exp(−k·ballPrice/value)`, k free | k = 1.388 | 0.00 | 0.62 (3) | **best; near-perfect fit** |
| `a·ballPrice` (linear in price) | a = 0.00159 | +0.49 | 1.12 (3) | tied — see "not yet decided" |
| `a·ballPrice^b` | b = 0.917 | +1.61 | 0.24 (2) | no gain over 1 param |
| piwtools (`k = 1.75` fixed) | — | +9.15 | 11.78 (4) | **rejected** (LR p ≈ 0.0008) |
| `a·catchRate` (linear 1/2/3/4) | a = 0.0342 | +46.65 | 47.28 (3) | **rejected** (p < 1e-9) |
| `1 − exp(−c·catchRate)` | c = 0.0357 | +50.08 | 50.70 (3) | **rejected** |

### Findings (established)

1. **Catch chance scales with ball *price* (5/20/50/130), not with the game's
   `catchRate` field (1/2/3/4).** Observed cross-ball ratios 1 : 3.0 : 6.9 : 17.5
   track price ratios (1:4:10:26), decisively not catchRate ratios (1:2:3:4).
2. **The piwtools functional form is right; its constant is wrong.** Fitted
   k = **1.388**, 95% CI **[1.20, 1.59]**; piwtools' 1.75 lies outside
   (LR test p ≈ 0.0008). Fit quality with k=1.39: predicted 0.86 / 3.41 / 8.31 /
   20.20% vs observed 1.15 / 3.50 / 7.95 / 20.16%.
3. Red herrings eliminated: `captureBase` in creatures.json is the base form's
   national dex ID (used for sprite lookup), not a catch stat. `catchChance` in
   `hunt-config` is 0 for all 241 hunts (dead field). The `balls` catalog's
   `catchRate` does not enter the formula.

### Assumptions (not yet tested)

- **A1 — value denominator:** the formula divides by the creature's *value*, and
  Phase 1 only ran at value=800, so k is entangled with the value exponent.
  `k·price/value^α` with α≠1 would refit with a different k.
- **A2 — which value field:** `priceNpc` vs `sellValue` is undecided (identical for
  Abra). Pidgey/Oddish (priceNpc=5, sellValue=60/80) discriminate.
- **A3 — exponential vs linear in price:** at value 800 all rates are ≤20% where
  `1−exp(−x) ≈ x`; the two shapes only diverge in the saturation region (cheap
  species, high rates).
- **A4 — no other covariates:** level/rarity effects assumed absent; Phase 2's
  value sweep doubles as a residual check (rarity is held COMMON; Charmander
  RARE @3000 vs Gastly COMMON @3000 is the direct rarity probe if needed).
- **A5 — trials are homogeneous:** all Phase-1 throws were auto-catch on corpse
  (one throw per kill), so HP-at-throw is constant and irrelevant.

## Phase 2 — design (next)

One account per cell, ~1h each, auto-catch with the stated ball:

| account | hunt | value | ball | decides | predictions (k=1.39 exp · linear-price) |
| --- | --- | ---: | --- | --- | --- |
| A | Krabby | 200 | Ultra | A3: exp vs linear | **59.5%** vs ~90% |
| B | Rattata | 5 | Poké | A3: saturation ceiling | ~75% vs 100% flat |
| C | Pidgey | 5 / 60 | Poké | A2: priceNpc vs sellValue | ~75% (priceNpc) vs ~11% (sellValue) |
| D | Hypno | 11,000 | Ultra | A1: value exponent (800→11k leverage) | 1.63% (α=1) |

Practical notes: Krabby/Hypno Ultra cells burn ~110–117k gold/h in balls (partly
recouped by selling catches). Rattata/Pidgey Poké cells catch at high rates —
expect hundreds of caught pokemon per hour; watch storage limits mid-session
(if storage caps auto-catch, the trial stream stops silently — check the
capture's `catch-result` cadence).

## Outcome (to fill after Phase 2)

Final formula + constants → replace the piwtools heuristic in
`hunt_optimizer.html` (`bestCapture`/`captureRate`) and re-derive the Captura,
Lucro total and Gold/hora tabs.

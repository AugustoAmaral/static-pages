# Catch-rate reverse engineering (Poke Idle World)

**Status:** Phase 4 complete — model found. It is a mainline-Pokémon-style capped
power law in the ball's **`catchRate` (1/2/3/4)**, not the price:

```
p = min(1,  C · catchRate^a / priceNpc^b )     C ≈ 3.48,  a ≈ 2.05 (~cr²),  b ≈ 0.90
```

Fitted by binomial MLE over 16 cells / ~14,000 trials spanning value 5→11,000 and all
four balls: **12/16 cells within their 95% CI** (2 of the 4 "misses" are saturation
artifacts where the model predicts exactly 100% against 99.7–99.85% observed). This
beats every price-based / logistic / compound-roll alternative by ΔAIC ≥ 55.
Residual mysteries: Abra/Ultra underpredicted (14.8% vs 20.2%) and Paras/Great
overpredicted (36.5% vs 31.8%) — likely a small HP/rounding term in the true formula.
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

## Phase 2 — value axis, field, saturation (2026-07-15, same day)

Setup: 4 accounts, one (hunt, ball) cell each, ~1h. 2,126 valid trials.

| cell | value (priceNpc) | trials | catches | observed | 95% CI |
| --- | ---: | ---: | ---: | ---: | --- |
| Krabby / Ultra | 200 | 651 | 329 | 50.54% | 46.71–54.36% |
| Rattata / Poké | 5 | 347 | 292 | 84.15% | 79.94–87.62% |
| Pidgey / Poké | 5 (sell 60) | 508 | 427 | 84.06% | 80.62–86.98% |
| Hypno / Ultra | 11,000 | 620 | 11 | 1.77% | 0.99–3.15% |

### Resolutions

- **A2 resolved — the field is `priceNpc`.** Pidgey (priceNpc 5, sellValue 60)
  caught at 84.06% vs Rattata (5/5) at 84.15% — statistically identical. The
  sellValue hypothesis predicted ~11% for Pidgey. Dead.
- **A3 resolved — saturating, and NOT the exponential.** Krabby/Ultra observed
  50.54%; linear-in-price predicted ~90% (dead), the exp form with Phase-1's
  k=1.39 predicted 59.5% (outside CI). The **odds-linear (logistic) form** fits:
  `odds = k·price/value` → Krabby predicted 49.4% at k=1.5. On the six cells with
  value ≥ 200 the logistic gives deviance **0.83 on 5 df** (near-perfect) vs 8.44
  for the exp form. Fitted **k = 1.540, 95% CI [1.384, 1.710]** — consistent with
  **k = 1.5 exactly**, i.e. `p = 3·price/(3·price + 2·priceNpc)`, which predicts
  0.93/3.61/8.57/19.60/49.37/1.74% vs observed 1.15/3.50/7.95/20.16/50.54/1.77%.
- **A1 resolved (value exponent = 1).** Krabby vs Abra at the same ball and same
  huntLevel: observed odds ratio 4.04 vs value ratio 4.00.
- **HP hypothesis killed.** Rattata/Pidgey mobs have maxHp 120 — the same as
  low-level Abra mobs — yet catch at 84% vs 1.15% (same ball). Mob HP is not in
  the formula (all throws are on-kill anyway).

### The remaining puzzle — "newbie anomaly"

Value-5 species (Rattata, Pidgey; both huntLevel-1 hunts) catch at **84%** where
the model predicts **60%** (odds 5.3 observed vs 1.5 predicted — a ×3.5 boost).
Confirmed on two different accounts independently. Candidate explanations:
a boosted branch for starter/level-1 hunts; an effective-value offset
(`value − c`, c≈3.5, negligible for value ≥ 60); or a per-ball floor. The
boundary of the anomaly is unknown — everything between value 5 and 200 is
unmeasured.

## Phase 3 — design (next)

Map the low-value region and the anomaly's driver. One account per cell, ~1h,
all cheap cells (Poké/Great):

| account | hunt | priceNpc | huntLevel | ball | model predicts | tests |
| --- | --- | ---: | ---: | --- | ---: | --- |
| A | Paras | 60 | 1 | Poké | 11.4% | hLv-1 boost? (low value, newbie hunt) |
| B | Bellsprout | 80 | 1 | Poké | 8.8% | hLv-1 boost, second point |
| C | Spearow | 100 | 10 | Poké | 7.1% | control (similar value, hLv 10) |
| D | Rattata | 5 | 1 | **Great** | 86.0% | anomaly's ball-scaling: odds-boost ⇒ ~95%; p-cap ⇒ ~84% |

Reading: if A/B overperform while C fits → the boost is tied to level-1/starter
hunts. If A/B/C all fit → the anomaly is confined to value≈5 and D's ball-scaling
pins its functional form.

## Phase 3 — low-value region & anomaly driver (2026-07-15, evening)

Setup: 4 accounts, ~1h each. 2,250 valid trials.

| cell | value | huntLevel | trials | catches | observed | 95% CI | k=1.54 predicted |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Paras / Poké | 60 | 1 | 749 | 64 | 8.54% | 6.75–10.76% | 11.4% |
| Bellsprout / Poké | 80 | 1 | 516 | 32 | 6.20% | 4.43–8.62% | 8.8% |
| Spearow / Poké | 100 | 10 | 616 | 32 | 5.19% | 3.70–7.24% | 7.1% |
| Rattata / Great | 5 | 1 | 369 | 368 | **99.73%** | 98.48–99.95% | 86.0% |

### Hypotheses killed

- **huntLevel-1 boost: dead.** Paras/Bellsprout (hLv 1) and Spearow (hLv 10) imply
  the same per-ball constant (k_Poké = 1.12 / 1.06 / 1.10) — no newbie-hunt effect.
- **84% cap: dead.** Rattata with Great hit 99.73% (368/369).
- **Constant-k logistic (`odds = k·price/value`, k universal): dead.** Poké cells at
  value 60–100 give k ≈ 1.10; Ultra cells at value 200–11,000 give k ≈ 1.55.
  Ball strength is not proportional to price.

### Current best description

Per-ball strength table, `odds = A(ball)/priceNpc`, fits **all 9 cells with
value ≥ 60** within CI:

| ball | A (empirical) | A/price | `price^1.1` |
| --- | ---: | ---: | ---: |
| Poké | 5.5 | 1.10 | 5.9 |
| Great | 29 | 1.45 | 27.0 |
| Super | 69 | 1.38 | 74.4 |
| Ultra | 201 | 1.55 | 211 |

The one-parameter form **`odds = price^1.1 / priceNpc`** is inside every cell's CI.

**Value-5 branch:** observed odds are ×4.8 (Poké) and ×63 (Great) above the table —
a qualitatively different regime. A compound-roll model `p = 1−(1−k/v)^(price^a)`
(k=1.62, a=0.93) explains value-5 naturally but misses Paras/Bellsprout/Abra-Ultra.
No species exists with priceNpc between 5 and 60, so the branch boundary cannot be
mapped by species; it must be probed by ball tier at value 5.

## Phase 4 — ball sweep on a fixed species (2026-07-15, night)

Setup: 4 accounts, ~1h each (large n). 5,124 valid trials.

| cell | value | ball | catchRate | trials | catches | observed | 95% CI |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| Paras / Great | 60 | Great | 2 | 1379 | 438 | 31.76% | 29.36–34.27% |
| Paras / Super | 60 | Super | 3 | 1313 | 1100 | 83.78% | 81.69–85.67% |
| Paras / Ultra | 60 | Ultra | 4 | 1318 | 1316 | 99.85% | 99.45–99.96% |
| Rattata / Super | 5 | Super | 3 | 845 | 845 | 100.00% | 99.55–100.00% |

The Paras ball sweep is what broke the separable `A(ball)/value` model: at fixed
value 60, Super (83.8%) and Ultra (99.85%) came in far above the Abra-derived table
(53.5% / 77%), while Poké/Great matched. A per-ball constant cannot explain this —
the ball's effect grows super-linearly, which is the `catchRate^~2` power law.

### The model (final)

Refit over all 16 cells (Phases 1–4). Winner by a wide margin:

`p = min(1, C · catchRate^a / priceNpc^b)`, MLE **C = 3.48, a = 2.05, b = 0.898**.

| ball | catchRate | catchRate^2.05 | price ratio (why Phase 1 fooled us) |
| --- | ---: | ---: | ---: |
| Poké | 1 | 1.0 | 1 |
| Great | 2 | 4.1 | 4 |
| Super | 3 | 9.6 | 10 |
| Ultra | 4 | 17.4 | 26 |

At value 800 (Phase 1's only species) `catchRate²` (1,4,9,16) is nearly collinear
with the price ratios (1,4,10,26) — so price fit there by coincidence. The full
value range disambiguates: `catchRate^2` wins, price loses by ΔAIC ≫ 50.

### Model comparison (16 cells, binomial MLE)

| family | best form | ΔAIC |
| --- | --- | ---: |
| **mainline power law** | `min(1, C·cr^a / v^b)` | **0** |
| power law, `s`-exponent | `min(1, (C·cr^a/v^b)^s)` | +1.4 |
| mainline w/ price | `min(1, (C·price^a/v)^s)` | +55.7 |
| compound roll (cr) | `1−(1−k/v)^(cr^a)` | +65 |
| compound roll (price) | `1−(1−k/v)^(price^a)` | +135 |
| odds power `(k·price/v)^g` | — | +318 |

### Findings (established)

- **The ball variable is `catchRate` (1/2/3/4), in a ~square power law**, not price.
  Corrects Phase 1's price conclusion (an artifact of testing only value=800).
- **Value is `priceNpc` with exponent ≈0.9** (near 1). Confirmed across value 5→11000.
- **Saturating cap at 1** (mainline shape) — explains the value-5 "explosion" and the
  Paras Super/Ultra overshoot as the same thing: high `cr^2/value` saturates fast.
- The "newbie anomaly" dissolves: Rattata/Pidgey at 84% is just `min(1, 3.48·1/5^0.9)`
  ≈ 82%, not a special branch. No huntLevel effect (Phase 3 already showed this).

### Open residuals (~few pp, not blocking)

Abra/Ultra sits above the curve (20.2% vs 14.8%) and Paras/Great below (31.8% vs
36.5%). A true mainline formula has an HP term `(3·maxHP−2·HP)/3·maxHP` and integer
rounding of a 0–255 rate; either could produce residuals of this size. Not worth more
farming unless we want the exact server constants.

## Outcome — SHIPPED

`hunt_optimizer.html` now uses the measured formula
`p = min(1, 3.48 · catchRate^2.05 / priceNpc^0.898)` in `captureRate`/`bestCapture`
(BALLS carry `catchRate`; ball price is only the cost term). The Captura, Lucro total
and Gold/hora tabs are re-derived from it. This is validated across 14k trials and is
far more accurate than the old piwtools form (`1−e^(−1.75·price/value)`), which
mis-modeled both the ball axis and the saturation.

### Ball catalog (from the WS `balls` frame) — confirms the mainline system

| ball | id | catchRate | price | notes |
| --- | ---: | ---: | ---: | --- |
| Poké | 1 | 1 | 5 | buyable |
| Great | 2 | 2 | 20 | buyable |
| Super | 3 | 3 | 50 | buyable |
| Ultra | 4 | 4 | 130 | buyable |
| Idle | 6 | 5 | 400 | not buyable; `catchRate²` ⇒ ≈1.58× Ultra |
| Master | 5 | 255 | 0 | not buyable; 255 = mainline "guaranteed" — free, so price is provably irrelevant |

Master Ball (catchRate 255, **price 0**) is the clincher that the driver is the
`catchRate` field, not price. Only the 4 buyable balls enter the tool's best-ball
economics. **Shiny catch rate:** the formula keys on species `priceNpc` (a species
constant, not the individual), and `catch-result` frames carry no shiny flag, so the
predicted rate is identical for shiny and normal — unverified (0 shiny trials in
~14k; shinies are far too rare to sample by farming).

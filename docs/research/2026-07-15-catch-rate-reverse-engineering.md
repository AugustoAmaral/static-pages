# Catch-rate reverse engineering (Poke Idle World)

**Status:** Phase 2 complete. Best model: **odds-form `p/(1−p) = 1.5·ballPrice/priceNpc`**
(≡ `p = 3·price/(3·price + 2·value)`), near-perfect on all cells with value ≥ 200.
Open: a "newbie anomaly" — value-5 species catch at 84% where the model predicts 60%.
Phase 3 designed to resolve it.
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

## Outcome (to fill after Phase 3)

Final formula + constants → replace the piwtools heuristic in
`hunt_optimizer.html` (`bestCapture`/`captureRate`) and re-derive the Captura,
Lucro total and Gold/hora tabs. As of Phase 2 the working formula for the
normal regime is `p = 1.5·bp/(v + 1.5·bp)` with bp = ball price, v = priceNpc.

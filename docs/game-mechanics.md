# Poke Idle World — reverse-engineered mechanics & `hunt_optimizer` formulas

Master reference for everything the tool computes. All numbers here were **measured**
(not guessed) by capturing the game's live WebSocket traffic and fitting models to the
data. Detailed derivations live in the linked phase docs; this file is the summary a
future reader (or future us) needs in one place.

- Tool: [`hunt_optimizer.html`](../hunt_optimizer.html)
- Efficiency design/plan: [`specs/2026-07-14-hunt-efficiency-design.md`](superpowers/specs/2026-07-14-hunt-efficiency-design.md), [`plans/2026-07-14-hunt-efficiency.md`](superpowers/plans/2026-07-14-hunt-efficiency.md)
- Catch-rate study (4 phases, ~14k trials): [`research/2026-07-15-catch-rate-reverse-engineering.md`](research/2026-07-15-catch-rate-reverse-engineering.md)

---

## 1. How the data was obtained

The game is a browser client that streams world state over
`wss://poke.idleworld.online/ws4` as **JSON** frames. A console hook
(`scratchpad/piw-capture.js`, kept out of the repo) wraps `WebSocket` + `fetch` +
`XMLHttpRequest` and records every frame with a timestamp. With auto-catch on, the
character farms AFK and emits one `catch-result` per kill, turning a session into a
stream of labelled Bernoulli trials. Multiple accounts run different conditions in
parallel; the controller de-dupes and fits by maximum likelihood.

**Key WS message types**

| type | carries |
| --- | --- |
| `field` | tick: `hero` + `mobs[]` positions (`slot`, `hp`, `maxHp`, `dead`, `respawning`), `serverNow`, `allMobsDead`, `waveRespawnAt` |
| `field-init` | on entering a hunt: walkable `grid`, rows/cols, tile offset |
| `field-kill` | per kill: `xpGained`, `xpParts` (base/vip/boost/event), `loot[]` |
| `catch-result` | per throw: `speciesName`, `ballName`, `ballId`, `success`, `auto` |
| `balls` | ball catalog (`id`, `name`, `catchRate`, `priceGold`) |
| `pokes` / `poke-delta` | team & newly caught pokemon (stats, sellValue, looktype) |

**Static data endpoints** (public, no auth; no CORS → the tool loads committed snapshots)

| endpoint | → `assets/…` | shape |
| --- | --- | --- |
| `/game/creatures.json` | `creatures.json` | per species: types, rarity, base stats, huntLevel, evolve, `priceNpc`, `sellValue`, `experience`, `loot[]`, `attacks[]` |
| `/game/items.json` | `items.json` | item `npcPrice` (loot valuation) |
| `/api/game/map-markers` | `map-markers.json` | hunts: `slug`, `name`, `area`, `level`, `range` (game-tile bbox) |
| `/api/game/hunt-config?slug=X` | `hunt-configs.json` | per hunt: `spawns:[{pokeId,x,y}]`; we bake `n` + `route` |

Refresh everything with `node scripts/rebuild-data.mjs` (Node 18+, no deps).

---

## 2. Measured game constants

| constant | value | how measured |
| --- | --- | --- |
| Respawn interval | **60.0 s** per spawn slot, timed from death | 143+ death→respawn cycles, σ≈0 |
| Walk speed | **0.600 s/tile** (1.667 tiles/s) | 1,200+ hero steps, p25–p75 = 0.599–0.601 |
| Spawns per hunt (N) | **15** (239/240 hunts; 1 has 5) | `hunt-config` for every hunt |
| Efficiency factor F | **1.23** | fit of kills/min on 5 profiled hunts (~3–7% error) |

---

## 3. Hunt efficiency model (kills/min → XP/h, Gold/h)

`route` is the nearest-neighbour tour (Chebyshev distance, start at spawn 0) over a
hunt's spawn coordinates, precomputed into `hunt-configs.json`.

```
lapWalk   = route × 0.6 / F                       # seconds to clear one lap on foot
cycle     = lapWalk + N × killTime                # + time spent killing (killTime input, 0 = hitkill)
killsPerMin = N × 60 / max(cycle, 60)             # 60 s = respawn; max() unifies both regimes
xpPerHour   = killsPerMin × 60 × xpPerKill × xpMult
goldPerHour = killsPerMin × 60 × (lootPerKill + captureNet)
```

- **`max(cycle, respawn)`** is the whole trick: clear a lap faster than 60 s and you
  idle until respawn (**respawn-limited**, ceiling = N/min = 15/min); slower and you're
  **size/travel-limited**. Only ~19/240 hunts are respawn-limited; the rest are travel.
- **F = 1.23** absorbs that mobs wander toward you and the poké auto-attacks at range,
  so the real lap is ~23% shorter than the bare spawn tour.
- Parameters (walk, respawn, F, xpMult, killTime) are user-adjustable in the tool;
  the defaults above are the measured values. `xpMult` = XP multipliers (measured VIP
  bonus is ×1.5, from `field-kill.xpParts`).

Validation (measured vs model kills/min): Krabby 14.7/14.2, Charmander 11.3/11.3,
Squirtle 9.3/9.9, Gloom 8.1/7.9, Gastly 14.5/15.0(cap), Hypno 13.8 exact with
killTime≈1.3 s. Abra is a known ~+18% outlier (noisy exploratory session).

---

## 4. Catch-rate formula (SOLVED — mainline power law)

```
captureRate = min(1,  C · catchRate^A / priceNpc^B )     C = 3.48,  A = 2.05,  B = 0.898
```

- **The ball variable is `catchRate` (1/2/3/4/…), not the ball's price**, applied ≈²
  (so Ultra ≈ 16× Poké, not 4×). Price only enters as the *cost* term below.
- **Value is `priceNpc`** (species constant), exponent ≈0.9. Not `sellValue`
  (proved: Pidgey priceNpc 5 / sellValue 60 catches like Rattata 5/5).
- **Saturating cap at 1** = the mainline Pokémon "rate out of 255" system, confirmed by
  the Master Ball's `catchRate = 255` (guaranteed) at **price 0** — a free ball being
  the best is what proves price is irrelevant.
- Fitted by binomial MLE over 16 cells / ~14,000 trials, value 5→11,000, all balls:
  12/16 within 95% CI (beats price/logistic/compound forms by ΔAIC ≥ 55).
- Known residuals (~5 pp): Abra/Ultra under, Paras/Great over — likely the true
  formula's HP term + integer rounding. Not modelled.

Replaces the old piwtools heuristic `1−e^(−1.75·price/value)`, which mis-modelled both
the ball axis (used price) and the saturation.

### Ball catalog (from the WS `balls` frame)

| ball | id | catchRate | price (gold) | buyable | in best-ball economics? |
| --- | ---: | ---: | ---: | --- | --- |
| Poké | 1 | 1 | 5 | yes | yes |
| Great | 2 | 2 | 20 | yes | yes |
| Super | 3 | 3 | 50 | yes | yes |
| Ultra | 4 | 4 | 130 | yes | yes |
| Idle | 6 | 5 | 400 | no (idle reward) | no — rate shown in hover only |
| Master | 5 | 255 | 0 | no | no — guaranteed catch |

### Capture economics (what the tool ranks)

```
captureNet  = sellValue × captureRate(bestBall) − bestBall.price      # net gold per kill from catching
bestBall    = argmax over BUYABLE balls of ( sellValue × captureRate − price )
```

Since ball strength is now sub-proportional to price, the best-profit ball is often
**Super**, not Ultra (Ultra's 130-gold cost rarely pays for its marginal chance).
`captureNet` feeds the **Gold/hora** tab and the **Lucro total** metric; `bestBall` +
its rate show in the **Captura** tab/column, and all balls (incl. Idle) show in the
hover breakdown.

**Shiny:** the formula keys on species `priceNpc`, not the individual, and
`catch-result` has no shiny flag → predicted shiny rate = normal rate. Unverified (0
shiny trials in ~14k; too rare to sample by farming).

---

## 5. What the tool surfaces

Tabs (each ranks a different field; all reuse one chart/table/hover engine):

- **💰 Lucro (loot/kill)** — expected loot gold per kill.
- **💵 Lucro total** — loot + capture net (loot/kill + captureNet).
- **⭐ XP** — experience per kill.
- **🎯 Captura** — best-ball catch % per monster.
- **✨ XP/hora**, **✨ Gold/hora** — per-hour, folding in hunt density/respawn/size (§3).
  AI-badged and snapshot-derived; struck through if the official data diverges from the
  committed snapshot (rebuild to refresh).

Plus filters (rarity, type, hunt level, area, specific hunt) and an efficiency
parameters panel.

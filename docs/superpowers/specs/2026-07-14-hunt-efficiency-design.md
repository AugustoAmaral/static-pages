# Hunt Efficiency (XP/h & Gold/h) — Design

Add per-hunt **efficiency** metrics to `hunt_optimizer.html`: how much XP and gold
per hour a hunt yields, accounting for spawn **density**, **respawn**, hunt **size**,
walk speed and kill time. The main goal is an **XP/hour** ranking of hunts (since XP
per kill is fixed per level, efficiency is dominated by kill *rate*), plus a
**Gold/hour** ranking that folds in the loot + capture + sale work already shipped.

## Reverse-engineered game mechanics

Derived from live WebSocket capture (`wss://…/ws4`, JSON frames) across 7 hunts
(gastly, abra, hypno, krabby, charmander, squirtle, gloom). All measured constants
were rock-solid across hunts:

| Constant | Value | Source |
| --- | --- | --- |
| Respawn interval | **60.0 s** per spawn, from death | 143+ death→respawn cycles, σ≈0 |
| Walk speed | **0.600 s/tile = 1.667 tiles/s** | 1200+ hero steps, p25–p75 = 0.599–0.601 |
| Spawns per hunt (N) | **15** (239/240 hunts; 1 has 5) | `hunt-config` for all hunts |

Key WS message types: `field` (hero + `mobs[]` positions, each with `slot`, `hp`,
`dead`, `respawning`), `field-init` (walkable `grid`), `field-kill` (xp + loot per
kill), `catch-result`. The `field` payload also carries `allMobsDead` / `waveRespawnAt`
(the "cleared the whole hunt" wave-respawn, only relevant to tiny hunts).

Spawn geometry comes from a **public** endpoint:
`GET /api/game/hunt-config?slug=<slug>` → `{ start, spawns:[{pokeId,x,y}], catchChance }`.
No auth, no CORS headers.

## The model

```
route      = nearest-neighbour tour over spawn (x,y), Chebyshev distance  (tiles)
lapWalk    = route / walkSpeed / F                                        (seconds)
cycle      = lapWalk + N × killTime                                       (seconds)
killsPerMin = N × 60 / max(cycle, respawn)                               respawn = 60 s
xpPerHour   = killsPerMin × 60 × xpPerKill × xpMult
goldPerHour = killsPerMin × 60 × (lootPerKill + captureNet)
```

- **`F = 1.23`** — empirical efficiency factor: mobs wander toward the player and the
  active poké auto-attacks within a range, so the real lap is shorter than the bare
  spawn tour. Fitted on 3 clean travel-limited hunts (mean error 3.3%).
- **`max(cycle, respawn)`** unifies both regimes: if you clear a lap faster than 60 s
  you idle until respawn (**respawn-limited**, ceiling = N/min = 15/min); if the lap
  takes longer you are **size/travel-limited**.
- **`killTime`** — seconds per kill; `0` = hitkill (the realistic ceiling). Validated:
  hypno at killTime≈1.3 s reproduced the observed 13.8/min exactly.

Validation (7 hunts): ranking exact, absolute error ~3–7%.

Calibration provenance is intentionally thin (7 hunts). `F`, `walkSpeed`, `respawn`
and `xpMult` are all **exposed as adjustable parameters** with these measured defaults,
so the model can be refined later without code changes.

## Data pipeline

The tool is a static page with no CORS access to the game API, so all inputs are
**committed snapshots** in `assets/` (existing pattern for creatures/items/markers).

- **New snapshot** `assets/hunt-configs.json`: `{ "<slug>": { spawns:[{pokeId,x,y}], route, n } }`
  for all ~240 hunts (~110 KB). `route` (precomputed NN tour) and `n` are baked in so
  the page does no geometry at load.
- **New rebuild script** `scripts/rebuild-data.mjs` (Node, no deps): re-fetches
  `creatures.json`, `items.json`, `map-markers`, and every `hunt-config?slug=…`, writes
  them to `assets/`, and precomputes `hunt-configs.json` (route + n per hunt). This is
  the single command to refresh the whole base. Documented in a short `scripts/README`.

## UI integration (`hunt_optimizer.html`)

Reuse the existing tab/field architecture (as with `lucroTotal`/`captura`).

- **Two new tabs**, badged as **AI-computed** (a small "✨ AI" / sparkle marker rather
  than a raw ⚡, to read as derived/estimated):
  - **XP/hora** — field `xpPerHour`, formatted compact.
  - **Gold/hora** — field `goldPerHour` = `killsPerMin × 60 × (loot + captureNet)`.
- **Per monster**: use the monster's linked hunt `slug` (already computed as
  `huntSlugs`, filtered by the active area) → `hunt-configs.json` → `killsPerMin`.
  Monsters with no hunt show "—" on these tabs (excluded from the ranking).
- **New table columns**: `kills/min`, `XP/h`, `Gold/h`, and a **regime badge**
  ("respawn" vs "tamanho"). Sortable like the rest.
- **Hover card** additions: kills/min, lap distance & time, density (N / route),
  and which regime limits it.
- **Parameters panel** (measured defaults, adjustable — same spirit as the site's
  "kills/h"): walk speed `1.67`, respawn `60`, efficiency `F=1.23`, XP multiplier
  `1.0` (note: VIP observed = 1.5×), kill-time `0` (hitkill).
- **AI/snapshot popover**: explains these numbers are computed from a committed
  snapshot (can't refetch 240 hunts per page load, no CORS). When the user runs
  "Verificar dados oficiais" and the official creatures/items/markers diverge from the
  snapshot, the per-hour values render **struck-through** with the popover changed to
  "estes números podem estar desatualizados — rode o rebuild" (because spawn geometry
  can't be re-derived live).

## Edge cases

- **Monster ↔ hunt is many-to-one/one-to-many**: pick the hunt slug matching the active
  area filter; if several, the first; if none, exclude from per-hour tabs.
- **Species mismatch** (variant creatures vs hunt marker name): fall back to the
  existing name/looktype link already used by `compute()`.
- **The one N=5 hunt** and any future non-15 hunt: `N` comes from the snapshot per hunt,
  so the ceiling adapts automatically.
- **killTime very high**: `max(cycle, respawn)` still holds; kills/min just drops.

## Testing

- Unit-check the model against the 7 measured hunts (fixtures of route+N → expected
  killsPerMin within ±8%).
- Verify tab switching, sorting, and that loot/XP/capture tabs are unchanged.
- Verify the stale/strike-through behaviour triggers on a simulated data divergence.
- Drive it in a headless browser (as with the previous features) and compare rendered
  kills/min for gastly/abra/charizard against the model.

## Out of scope (v1)

- Live pathfinding over the walkable `grid` (walls). The straight-line tour + `F`
  already fits within ~7%; grid pathing is a future refinement if profiling shows
  size-dependent bias.
- Per-hunt kill-time estimation from player power (kill-time stays a manual input).
- Multi-species hunts weighting (all measured hunts are single-species).

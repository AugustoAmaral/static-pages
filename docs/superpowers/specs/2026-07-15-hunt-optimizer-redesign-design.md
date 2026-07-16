# Hunt Optimizer v2 — UI redesign

**Date:** 2026-07-15
**Status:** approved design, pending implementation plan
**Replaces the UI of:** `hunt_optimizer.html` (full rewrite of the page; data flow and math model carried over)

## Goals

- The page answers "what is the best hunt for me right now?" immediately, and still
  supports free exploration below.
- Kill the confusing bits: per-kill profit tabs, "AI" badges, the exposed model
  parameters (walk / respawn / efficiency F / kill-time), free-numeric level inputs.
- Keep the repo pattern: single self-contained HTML file, vanilla JS, zero build.
- Add PostHog analytics (currently **not present** anywhere in the repo or the
  deployed site, despite prior belief).

## Non-goals

- No framework, no build step, no visual redesign of the other pages in the repo.
- No changes to the measured model constants or to `scripts/hunt-model.mjs`
  (`killsPerMin` stays in sync, tests untouched).
- No new data sources; snapshot → official-API verification flow is unchanged.

## Decisions (from brainstorm, validated on visual mockups)

1. **Views**: only three — `XP/h`, `Gold/h`, `Captura`. The per-kill tabs
   (Lucro loot/kill, Lucro total, XP) are removed. Per-kill numbers remain
   visible inside the popover.
2. **Layout**: sticky controls sidebar (left, ~220px) + main content. On narrow
   viewports the sidebar stacks on top. Header: title, discreet data-status line,
   theme toggle. The current "1. Dados" card is removed; manual file load moves
   into a modal reachable from the status line.
3. **Ranking = dense chart** (the main content): one ~26px row per creature —
   `rank · name · type squares · bar · value`. Top 25 by default plus a
   "show more" button (replaces the Top N input). DOM rows (divs), not SVG.
4. **Elemental scan without filtering**: type1/type2 shown as small colored
   squares next to the name on every row, using the standard Pokémon type
   palette. Dataset types (18): BUG, DARK, DRAGON, ELECTRIC, FAIRY, FIGHTING,
   FIRE, FLYING, GHOST, GRASS, GROUND, ICE, NORMAL, POISON, PSYCHIC, ROCK,
   STEEL, WATER. There is intentionally **no type filter** — the user wants to
   eyeball alternatives across types, not hide them.
5. **Popover carries the detail** (hover on desktop, tap on mobile): types,
   hunt level, area, kills/min + regime (respawn- vs travel-limited), XP/h,
   Gold/h with and without catch, capture chance per ball (⭐ on the best,
   Idle Ball flagged as non-buyable), and a "where the gold comes from"
   breakdown (loot items + capture·sell as one bar list). Must be fully
   clamped to the viewport (flip horizontally/vertically, cap height with
   internal scroll) — fixes the current bug of the popover escaping the screen.
6. **Level filter as selects**: two selects (from / to) over the 12 discrete
   hunt levels present in the data — 1, 10, 20, 30, 40, 50, 60, 70, 80, 100,
   150, 200 — plus an "any" option.
7. **Exposed options are exactly two**: `VIP (×1.5 XP)` checkbox (sets xpMult)
   and `count capture in Gold/h` checkbox (toggles captureNet). All other model
   parameters are fixed at the measured defaults (tile 0.6 s, respawn 60 s,
   F 1.23, killTime 0) and disappear from the UI.
8. **Search unification**: one name search box replaces both "buscar nome" and
   "hunt específica" (creature name ≈ hunt name).
9. **Hunt-status filter removed**: XP/h and Gold/h implicitly show only
   creatures with a mapped hunt (per-hour math requires hunt-configs).
   The Captura view shows all creatures passing the filters; in that view the
   area filter only applies to creatures that have hunts (creatures without a
   hunt have no area and must not be silently excluded by the default Kanto).
10. **No AI badges / sparkles**. Estimation honesty lives in the popover
    footnote and in the data-status line (snapshot + stale strike-through
    behavior kept).

## Sidebar controls

| Control | Widget | Notes |
| --- | --- | --- |
| Objetivo | segmented XP/h · Gold/h · Captura | drives ranking + scatter metric |
| Level (from/to) | two selects, discrete values + "any" | see decision 6 |
| Área | segmented Kanto · Outland · Todas | default Kanto (deduplicates) |
| Raridade | chips | MYTHIC/LEGENDARY off by default (as today) |
| VIP | checkbox | xpMult 1.5 when on, 1 otherwise |
| Contar captura | checkbox | Gold/h uses loot+captureNet vs loot only |
| Busca | text input | matches creature/hunt name |

## Math (carried over, made explicit)

- `killsPerMin(route, n, params)` — unchanged, KEEP IN SYNC with
  `scripts/hunt-model.mjs`.
- `xpPerHour = killsPerMin × 60 × experience × xpMult` (xpMult from VIP toggle).
- **Catch math uses the measured formula only** (docs/game-mechanics.md §4,
  research doc 2026-07-15): `rate = min(1, 3.48 · catchRate^2.05 / value^0.898)`
  with `value = priceNpc || sellValue`. Best ball maximizes per-kill profit
  `sellValue × rate − ballPrice` among **buyable** balls (Poke/Great/Super/Ultra);
  the Idle Ball (catchRate 5) is display-only. The old piwtools heuristic is dead.
- `captureNet = sellValue > 0 ? sellValue × bestRate − bestBall.price : 0`.
- `goldPerHour(with catch) = killsPerMin × 60 × (lootValue + captureNet)`;
  `goldPerHour(without) = killsPerMin × 60 × lootValue`. Both are computed;
  the checkbox picks which one ranks, the popover always shows both.
- Captura view ranks `capturePct` (best-ball rate).

## Secondary sections (below the ranking)

- **Scatter** effort × active metric (huntLevel on X, metric on Y, rarity
  colors, log-Y toggle) — collapsed by default, same behavior as today when open.
- **Full table** — collapsed. Columns realigned: name, rarity, types, hunt lv,
  area, kills/min, XP/h, Gold/h, capture % (+ best ball), top drop. Per-kill
  columns (loot/kill, venda, total, lucro total) are dropped from the table;
  those numbers live in the popover.

## Data flow (unchanged) & status line

GitHub snapshot → render immediately → verify against official API via proxy →
on divergence: modal (keep vs recalc) + stale strike-through on per-hour cells.
The big data card becomes a status line in the header with three states:
- ● green "dados verificados" (+ relative time)
- ● amber "dados divergem do snapshot" (click reopens the modal)
- ● gray "não foi possível verificar" (proxy failure)
Clicking the status line also exposes the manual-load modal (dropzones + paste,
same auto-detection logic as today).

## PostHog

- Official snippet in `<head>`, autocapture + default pageviews. Hosted on
  GitHub Pages, key is public by nature (that is fine for PostHog client keys).
- Key injected as a `POSTHOG_KEY` constant; if the real key is not provided by
  implementation time, ship with `""` and guard init (`if (POSTHOG_KEY)`), so
  the site works and the key is a one-line follow-up commit.
- Scope: `hunt_optimizer.html` only for now (other pages are a separate ask).

## Testing & verification

- `scripts/hunt-model.test.mjs` keeps passing untouched (model unchanged).
- Manual end-to-end check via browser (Playwright): page loads from snapshot,
  ranking renders for each objetivo, level selects filter, VIP/catch toggles
  change values, popover stays inside the viewport at all four screen corners,
  dark/light theme, mobile width.

## Known follow-ups (out of scope)

- Real PostHog key (user provides).
- Analytics on the other repo pages, if desired later.

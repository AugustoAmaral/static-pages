# scripts

- `hunt-model.mjs` — canonical kills/min + XP/h + Gold/h model (unit-tested). Keep in sync with the inline copy in `hunt_optimizer.html`.
- `hunt-model.test.mjs` — `node scripts/hunt-model.test.mjs`
- `rebuild-data.mjs` — refresh the whole data base from the official API:
  `node scripts/rebuild-data.mjs` → rewrites `assets/{creatures,items,map-markers,hunt-configs}.json`.

// scripts/rebuild-data.mjs
// Refreshes the whole committed data base from the official API and bakes hunt-configs.
// Usage: node scripts/rebuild-data.mjs   (Node 18+, no deps)
import { writeFile, readFile } from 'node:fs/promises';
import { routeLength } from './hunt-model.mjs';

const BASE = 'https://poke.idleworld.online';
const A = new URL('../assets/', import.meta.url);
const out = (name) => new URL(name, A);
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json(); };
const save = async (name, data) => { await writeFile(out(name), JSON.stringify(data, null, 1)); console.log('wrote', name); };

async function main() {
  // 1) core snapshots (same URLs the page already uses)
  await save('creatures.json', await getJson(`${BASE}/game/creatures.json`));
  await save('items.json', await getJson(`${BASE}/game/items.json`));
  await save('map-markers.json', await getJson(`${BASE}/api/game/map-markers`));

  // 2) hunt-configs for every real hunt (level>0, not a city label 1309)
  const markers = JSON.parse(await readFile(out('map-markers.json')));
  const slugs = [...new Set(markers.hunts
    .filter((h) => (h.level || 0) > 0 && Number(h.looktype) !== 1309)
    .map((h) => h.slug))];
  const configs = {};
  let done = 0;
  for (const slug of slugs) {
    try {
      const cfg = await getJson(`${BASE}/api/game/hunt-config?slug=${encodeURIComponent(slug)}`);
      const spawns = Array.isArray(cfg.spawns) ? cfg.spawns : [];
      if (spawns.length) configs[slug] = { n: spawns.length, route: routeLength(spawns), spawns };
    } catch (e) { console.warn('skip', slug, e.message); }
    if (++done % 40 === 0) console.log(`hunt-config ${done}/${slugs.length}`);
    await new Promise((r) => setTimeout(r, 80)); // be polite
  }
  await save('hunt-configs.json', configs);
  console.log(`done: ${Object.keys(configs).length} hunts`);
}
main().catch((e) => { console.error(e); process.exit(1); });

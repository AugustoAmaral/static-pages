# Hunt Efficiency (XP/h & Gold/h) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add XP/hora and Gold/hora efficiency rankings to `hunt_optimizer.html`, driven by a calibrated kills/min model over per-hunt spawn geometry.

**Architecture:** A canonical pure-JS model module (`scripts/hunt-model.mjs`) is unit-tested with plain `node:assert` and is the source of truth for the formula. A no-deps Node rebuild script fetches all game data and bakes `assets/hunt-configs.json` (route + N per hunt). `hunt_optimizer.html` inlines the same formula (kept in sync), loads the snapshot, and adds two tabs, table columns, hover detail, a params panel, and a stale/AI popover.

**Tech Stack:** Plain ES modules on Node 18+ (global `fetch`, `node:assert`, `node:fs`), vanilla browser JS inside the existing single-file tool. No build, no new dependencies.

## Global Constraints

- No new runtime dependencies; Node scripts use only built-ins (`node:fs`, `node:assert`, global `fetch`). Node 18+.
- Game constants (exact): respawn `RESPAWN_S = 60`, tile time `TILE_S = 0.6` (walk 1.667 t/s), efficiency `F = 1.23`, default spawns `N = 15` (real N per hunt from snapshot).
- Distances use **Chebyshev** (`max(|dx|,|dy|)`); NN tour **starts at spawn index 0** (deterministic, must match between module and snapshot).
- Snapshots live in `assets/` and are committed; the page must not fetch the game API at load (no CORS).
- Portuguese UI copy; code/comments in English. Match existing `hunt_optimizer.html` style (inline IIFE, `$`, `mk`, `TABS`, `state`).

---

### Task 1: Canonical model module + unit tests

**Files:**
- Create: `scripts/hunt-model.mjs`
- Test: `scripts/hunt-model.test.mjs`

**Interfaces:**
- Produces:
  - `export const MODEL_DEFAULTS = { tileS: 0.6, respawnS: 60, F: 1.23, xpMult: 1, killTimeS: 0 }`
  - `export function routeLength(spawns)` — `spawns: [{x,y}]` → integer Chebyshev NN tour from index 0.
  - `export function killsPerMin(route, n, p)` — `p` merges over `MODEL_DEFAULTS` → number.
  - `export function xpPerHour(kpm, xpPerKill, xpMult)` → number.
  - `export function goldPerHour(kpm, valuePerKill)` → number (`valuePerKill` = loot + captureNet per kill).

- [ ] **Step 1: Write the failing tests**

```js
// scripts/hunt-model.test.mjs
import assert from 'node:assert/strict';
import { routeLength, killsPerMin, xpPerHour, goldPerHour } from './hunt-model.mjs';

const approx = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol * b, `${a} !~ ${b}`);

// routeLength: Chebyshev NN from index 0 on a known set
assert.equal(routeLength([{x:0,y:0},{x:3,y:0},{x:3,y:4}]), 7); // 3 + 4

// killsPerMin — deterministic formula checks (defaults: tileS .6, respawn 60, F 1.23)
approx(killsPerMin(85, 15, {}), 15.0);   // gastly: lap 41.5s < 60 → respawn cap 15/min
approx(killsPerMin(234, 15, {}), 7.89);  // gloom: lap 114s → 900/114
approx(killsPerMin(164, 15, {}), 11.25); // charmander
approx(killsPerMin(94, 15, { killTimeS: 1.3 }), 13.77); // hypno w/ kill time

// per-hour helpers
approx(xpPerHour(15, 248, 1), 223200);   // gastly base XP
approx(goldPerHour(10, 50), 30000);

console.log('hunt-model: all assertions passed');
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/hunt-model.test.mjs`
Expected: FAIL — `Cannot find module './hunt-model.mjs'` (or import error).

- [ ] **Step 3: Write the model module**

```js
// scripts/hunt-model.mjs
// Calibrated on 7 profiled hunts (see docs/.../hunt-efficiency-design.md). ~3-7% error.
// KEEP IN SYNC with the inline copy in hunt_optimizer.html.
export const MODEL_DEFAULTS = { tileS: 0.6, respawnS: 60, F: 1.23, xpMult: 1, killTimeS: 0 };

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Nearest-neighbour tour length over spawn points, starting at index 0 (deterministic).
export function routeLength(spawns) {
  if (!spawns || spawns.length < 2) return 0;
  const unv = new Set(spawns.map((_, i) => i));
  let cur = 0; unv.delete(0); let L = 0;
  while (unv.size) {
    let best = -1, bd = Infinity;
    for (const j of unv) { const d = cheb(spawns[cur], spawns[j]); if (d < bd) { bd = d; best = j; } }
    L += bd; cur = best; unv.delete(best);
  }
  return L;
}

// route (tiles), n (spawns) → kills/min. p overrides MODEL_DEFAULTS.
export function killsPerMin(route, n, p = {}) {
  const { tileS, respawnS, F, killTimeS } = { ...MODEL_DEFAULTS, ...p };
  if (!n || route == null) return 0;
  const lapWalk = (route * tileS) / F;          // seconds to walk one lap
  const cycle = lapWalk + n * killTimeS;         // + time spent killing
  return (n * 60) / Math.max(cycle, respawnS);   // respawn ceiling via max(,respawn)
}

export function xpPerHour(kpm, xpPerKill, xpMult = 1) { return kpm * 60 * xpPerKill * xpMult; }
export function goldPerHour(kpm, valuePerKill) { return kpm * 60 * valuePerKill; }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/hunt-model.test.mjs`
Expected: PASS — prints `hunt-model: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/hunt-model.mjs scripts/hunt-model.test.mjs
git commit -m "feat(hunt-model): calibrated kills/min + per-hour model with tests"
```

---

### Task 2: Rebuild script + generate hunt-configs snapshot

**Files:**
- Create: `scripts/rebuild-data.mjs`
- Create: `scripts/README.md`
- Create (generated): `assets/hunt-configs.json`

**Interfaces:**
- Consumes: `routeLength` from `scripts/hunt-model.mjs`; `assets/map-markers.json` (for the slug list).
- Produces: `assets/hunt-configs.json` shaped `{ "<slug>": { n: number, route: number, spawns: [{pokeId,x,y}] } }`.

- [ ] **Step 1: Write the rebuild script**

```js
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
```

- [ ] **Step 2: Write scripts/README.md**

```markdown
# scripts

- `hunt-model.mjs` — canonical kills/min + XP/h + Gold/h model (unit-tested). Keep in sync with the inline copy in `hunt_optimizer.html`.
- `hunt-model.test.mjs` — `node scripts/hunt-model.test.mjs`
- `rebuild-data.mjs` — refresh the whole data base from the official API:
  `node scripts/rebuild-data.mjs` → rewrites `assets/{creatures,items,map-markers,hunt-configs}.json`.
```

- [ ] **Step 3: Run the rebuild**

Run: `node scripts/rebuild-data.mjs`
Expected: prints `wrote creatures.json` … `done: ~240 hunts`; `assets/hunt-configs.json` created.

- [ ] **Step 4: Sanity-check the snapshot**

Run: `node -e "const c=require('./assets/hunt-configs.json'); console.log(Object.keys(c).length, c.gastly.n, c.gastly.route)"`
Expected: `~240 15 85` (gastly N=15, route=85).

- [ ] **Step 5: Commit**

```bash
git add scripts/rebuild-data.mjs scripts/README.md assets/hunt-configs.json assets/creatures.json assets/items.json assets/map-markers.json
git commit -m "feat(scripts): rebuild-data + hunt-configs snapshot (route+N per hunt)"
git push origin main   # push the snapshot early: the page loads it from raw GitHub, so
                       # local browser testing of Tasks 3-7 needs it live on main.
```

---

### Task 3: Load snapshot + compute per-monster efficiency in `hunt_optimizer.html`

**Files:**
- Modify: `hunt_optimizer.html` — constants (~line 409), `state` (~433), `bootstrap()`/`fetchDirect` snapshot load, `compute()` (~646-681).

**Interfaces:**
- Consumes: `assets/hunt-configs.json` via a new `GH_HUNTCFG` URL; `state.filters.area`.
- Produces: on each computed monster: `killsPerMin`, `xpPerHour`, `goldPerHour`, `huntRoute`, `huntN`, `regime` ('respawn'|'size'|null). New `state.params`. New `state.huntConfigs`.

- [ ] **Step 1: Add constants + inline model (synced with hunt-model.mjs)**

Below `const CAPTURE_K = 1.75;` add:

```js
  // Hunt efficiency — see docs/superpowers/specs/2026-07-14-hunt-efficiency-design.md.
  // KEEP IN SYNC with scripts/hunt-model.mjs.
  const GH_HUNTCFG = GH_BASE + "/hunt-configs.json";
  const MODEL_DEFAULTS = { tileS: 0.6, respawnS: 60, F: 1.23, xpMult: 1, killTimeS: 0 };
  function killsPerMin(route, n, p) {
    const { tileS, respawnS, F, killTimeS } = Object.assign({}, MODEL_DEFAULTS, p || {});
    if (!n || route == null) return 0;
    const lapWalk = (route * tileS) / F;
    const cycle = lapWalk + n * killTimeS;
    return (n * 60) / Math.max(cycle, respawnS);
  }
```

- [ ] **Step 2: Add params + huntConfigs to `state`**

In `state`, after `sort: {...},` add:

```js
    huntConfigs: null, // { slug: {n, route, spawns} } from the snapshot
    huntStale: false,  // true once official data diverges (per-hour numbers may be off)
    params: { tileS: 0.6, respawnS: 60, F: 1.23, xpMult: 1, killTimeS: 0 },
```

- [ ] **Step 3: Load the snapshot in `bootstrap()`**

In `bootstrap()`, change the parallel load to also fetch hunt-configs (tolerate failure):

```js
      const [c, i, m, hc] = await Promise.all([
        fetchDirect(GH_CREATURES), fetchDirect(GH_ITEMS), fetchDirect(GH_MARKERS),
        fetchDirect(GH_HUNTCFG).catch(() => null),
      ]);
      state.huntConfigs = hc;
      gh = { c, i, m };
```

- [ ] **Step 4: Compute efficiency per monster in `compute()`**

At the end of the per-creature loop in `compute()`, before `out.push({`, add:

```js
      const hc = state.huntConfigs;
      const areaSlug = hc && hunts.length
        ? (hunts.find((h) => h.area === state.filters.area) || hunts[0]).slug : null;
      const hcfg = hc && areaSlug ? hc[areaSlug] : null;
      let killsPerMinV = 0, xpPerHour = 0, goldPerHour = 0, huntRoute = null, huntN = 0, regime = null;
      if (hcfg) {
        huntRoute = hcfg.route; huntN = hcfg.n;
        killsPerMinV = killsPerMin(hcfg.route, hcfg.n, state.params);
        const lapWalk = (hcfg.route * state.params.tileS) / state.params.F;
        regime = lapWalk + hcfg.n * state.params.killTimeS <= state.params.respawnS ? "respawn" : "size";
        xpPerHour = killsPerMinV * 60 * (Number(cr.experience) || 0) * state.params.xpMult;
        goldPerHour = killsPerMinV * 60 * (lootValue + captureNet);
      }
```

Then add to the pushed object (after `captureNet, profitTotal,`):

```js
        killsPerMinV, xpPerHour, goldPerHour, huntRoute, huntN, regime,
```

- [ ] **Step 5: Verify load + compute in a browser**

Run: `python3 -m http.server 8991` (repo root) and open `http://localhost:8991/hunt_optimizer.html` in a headless browser; after load run in console:
```js
JSON.stringify((()=>{const t=[...document.querySelectorAll('#tbody tr')].length;return {rows:t};})())
```
Expected: table renders, no console errors beyond favicon. (Full metric checks in Task 8.)

- [ ] **Step 6: Commit**

```bash
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): load hunt-configs snapshot, compute kills/min + XP/h + Gold/h"
```

---

### Task 4: XP/hora and Gold/hora tabs

**Files:**
- Modify: `hunt_optimizer.html` — tab buttons (~line 349-352), `TABS` (~443), `renderAll()` insight guard (~756).

**Interfaces:**
- Consumes: `state.computed[*].xpPerHour|goldPerHour`, `TABS.fmt`/`valFmt` (already added).
- Produces: `TABS.xpHora`, `TABS.goldHora`; two new tab buttons `data-tab="xpHora"|"goldHora"`.

- [ ] **Step 1: Add the tab buttons (with ✨ AI badge)**

Replace the tabs block with:

```html
  <div class="tabs" id="tabs" style="display:none">
    <button data-tab="lucro" class="active">💰 Lucro (loot/kill)</button>
    <button data-tab="lucroTotal">💵 Lucro total</button>
    <button data-tab="xp">⭐ XP</button>
    <button data-tab="captura">🎯 Captura</button>
    <button data-tab="xpHora">✨ XP/hora <span class="ai-badge">AI</span></button>
    <button data-tab="goldHora">✨ Gold/hora <span class="ai-badge">AI</span></button>
  </div>
```

- [ ] **Step 2: Add `.ai-badge` CSS**

After the `.tabs button.active` rule (~line 205) add:

```css
  .ai-badge { font-size: 9px; font-weight: 700; letter-spacing: .03em; padding: 1px 4px; margin-left: 4px;
    border-radius: 4px; background: linear-gradient(90deg,#7c3aed,#2563eb); color: #fff; vertical-align: middle; }
```

- [ ] **Step 3: Add the two tab configs to `TABS`**

After the `captura: {...},` entry add:

```js
    xpHora: {
      field: "xpPerHour", fmt: fmtCompact,
      rankTitle: "Ranking de XP por hora ✨",
      rankSub: (n, total) => `Top ${n} de ${total}. kills/min × XP/kill, contando densidade e respawn da hunt. Estimado de snapshot — pode variar.`,
      scatterTitle: "Esforço × XP/hora", scatterHint: "huntLevel × XP/h — cor por raridade",
      scatterSub: "Superior-esquerdo = fácil e muita XP por hora (o alvo pra grind).",
    },
    goldHora: {
      field: "goldPerHour", fmt: fmtCompact,
      rankTitle: "Ranking de Gold por hora ✨",
      rankSub: (n, total) => `Top ${n} de ${total}. kills/min × (loot + captura) por hora. Estimado de snapshot — pode variar.`,
      scatterTitle: "Esforço × Gold/hora", scatterHint: "huntLevel × Gold/h — cor por raridade",
      scatterSub: "Superior-esquerdo = fácil e muito gold por hora.",
    },
```

- [ ] **Step 4: Keep insight loot-only**

The `renderAll()` guard `if (state.tab === "lucro")` already hides the insight on other tabs — no change needed. Verify the two new tabs render ranking + scatter by clicking them in the browser.

- [ ] **Step 5: Commit**

```bash
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): XP/hora and Gold/hora tabs (AI-badged)"
```

---

### Task 5: Table columns + hover detail

**Files:**
- Modify: `hunt_optimizer.html` — `cols()` (~973-992), `tipCreature()` (~941-969).

**Interfaces:**
- Consumes: `killsPerMinV`, `xpPerHour`, `goldPerHour`, `huntRoute`, `huntN`, `regime` on each row.
- Produces: three sortable columns + hover rows.

- [ ] **Step 1: Add columns after the `capturePct` column in `cols()`**

```js
      { key: "killsPerMinV", label: "Kills/min", num: true, fmt: (d) =>
        d.huntN ? `${nf1.format(d.killsPerMinV)} <span class="rar" style="font-size:10px;color:${d.regime==='respawn'?'var(--rar-COMMON)':'var(--text-muted)'}">${d.regime==='respawn'?'respawn':'tamanho'}</span>` : `<span class="muted">—</span>` },
      { key: "xpPerHour", label: "XP/h ✨", num: true, fmt: (d) => d.huntN ? fmtCompact(d.xpPerHour) : `<span class="muted">—</span>` },
      { key: "goldPerHour", label: "Gold/h ✨", num: true, fmt: (d) => d.huntN ? fmtCompact(d.goldPerHour) : `<span class="muted">—</span>` },
```

- [ ] **Step 2: Add hover rows in `tipCreature()`**

After the `hunt` row block (the `state.hasMarkers ? ... : ""` expression), before `capHtml +`, add:

```js
      (d.huntN
        ? `<div class="t-row"><span>kills/min</span><b>${nf1.format(d.killsPerMinV)} (${d.regime === "respawn" ? "respawn-lim." : "tamanho-lim."})</b></div>` +
          `<div class="t-row"><span>XP/hora</span><b>${nf0.format(Math.round(d.xpPerHour))}</b></div>` +
          `<div class="t-row"><span>Gold/hora</span><b>${nf0.format(Math.round(d.goldPerHour))}</b></div>` +
          `<div class="t-bar-sub">volta ~${nf0.format(d.huntRoute)} tiles · ${d.huntN} spawns · respawn ${state.params.respawnS}s</div>`
        : "") +
```

- [ ] **Step 3: Verify in the browser**

Open the tool, switch to XP/hora, expand the table, hover a bar — expect kills/min, XP/hora, Gold/hora rows and the volta/spawns sub-line.

- [ ] **Step 4: Commit**

```bash
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): kills/min + XP/h + Gold/h table columns and hover"
```

---

### Task 6: Parameters panel

**Files:**
- Modify: `hunt_optimizer.html` — filters card (~307-333 area), `wire()` (~1106-1112).

**Interfaces:**
- Consumes: `state.params`.
- Produces: number inputs `#pWalk #pRespawn #pF #pXpMult #pKillTime` that update `state.params` and re-`compute()` + `renderAll()`.

- [ ] **Step 1: Add the params UI inside the filters card**

After the Raridade `.fgroup` block (~line 310), add:

```html
    <div class="fgroup" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--grid)">
      <label>Parâmetros ✨ (kills/min, XP/h, Gold/h)</label>
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:end">
        <div><label style="font-size:11px">walk (s/tile)</label><input type="number" id="pWalk" step="0.05" value="0.6" style="width:70px"></div>
        <div><label style="font-size:11px">respawn (s)</label><input type="number" id="pRespawn" step="1" value="60" style="width:70px"></div>
        <div><label style="font-size:11px">eficiência F</label><input type="number" id="pF" step="0.01" value="1.23" style="width:70px"></div>
        <div><label style="font-size:11px">XP mult (VIP 1.5)</label><input type="number" id="pXpMult" step="0.1" value="1" style="width:80px"></div>
        <div><label style="font-size:11px">kill-time (s, 0=hitkill)</label><input type="number" id="pKillTime" step="0.1" value="0" style="width:90px"></div>
      </div>
    </div>
```

- [ ] **Step 2: Wire the inputs in `wire()`**

After the `logY` listener add:

```js
    const recompute = () => { tryCompute(); };
    const bindParam = (id, key) => $(id).addEventListener("input", (e) => {
      const v = Number(e.target.value); if (!Number.isFinite(v)) return;
      state.params[key] = v; recompute();
    });
    bindParam("pWalk", "tileS"); bindParam("pRespawn", "respawnS"); bindParam("pF", "F");
    bindParam("pXpMult", "xpMult"); bindParam("pKillTime", "killTimeS");
```

- [ ] **Step 3: Verify recompute**

Open the tool on XP/hora; change `XP mult` to `1.5` → XP/h values scale ×1.5. Change `kill-time` to `2` → kills/min drops on respawn-limited hunts.

- [ ] **Step 4: Commit**

```bash
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): efficiency parameters panel (walk, respawn, F, XP mult, kill-time)"
```

---

### Task 7: AI/snapshot popover + stale strike-through on divergence

**Files:**
- Modify: `hunt_optimizer.html` — CSS (~227), `verifyAgainstOfficial()`/`openDiffModal` flow (~533-565), `cols()` per-hour formatters, a small info popover near the tabs.

**Interfaces:**
- Consumes: `state.huntStale`; the existing official-vs-snapshot diff flow.
- Produces: `state.huntStale=true` when official data diverges; per-hour columns/tabs render struck-through with a title tooltip.

- [ ] **Step 1: Add CSS for stale + popover**

After `.ai-badge` add:

```css
  .stale { text-decoration: line-through; opacity: .6; }
  .ai-note { font-size: 11px; color: var(--text-muted); margin: 6px 0 0; display: inline-flex; gap: 6px; align-items: center; cursor: help; }
  .ai-note .dot { width: 6px; height: 6px; border-radius: 50%; background: linear-gradient(90deg,#7c3aed,#2563eb); }
```

- [ ] **Step 2: Add the explainer note under the tabs**

Immediately after the `</div>` closing `#tabs`, add:

```html
  <p class="ai-note" id="aiNote" style="display:none"
     title="Kills/min, XP/h e Gold/h são estimados de um snapshot das 240 hunts (não dá pra recarregar tudo do servidor a cada visita, e a API não tem CORS). Rode scripts/rebuild-data.mjs pra atualizar.">
    <span class="dot"></span> ✨ Métricas por hora estimadas de snapshot — passe o mouse pra entender.</p>
```

Show it whenever tabs are shown: in the code path that reveals `#tabs`, also set `$("aiNote").style.display = "inline-flex";` (search for where `#tabs` display is toggled from `none`, in `tryCompute()`/render path, and add the line).

- [ ] **Step 3: Mark stale when official data diverges**

In the diff flow (`openDiffModal(diffs)` is called when official ≠ snapshot), set the flag and update the note. At the start of `openDiffModal`:

```js
    state.huntStale = true;
    const note = $("aiNote");
    if (note) { note.style.display = "inline-flex"; note.classList.add("stale");
      note.title = "Os dados oficiais mudaram — os números por hora vêm de um snapshot antigo e podem estar desatualizados. Rode scripts/rebuild-data.mjs."; }
```

- [ ] **Step 4: Strike-through per-hour cells when stale**

In `cols()`, wrap the three per-hour formatters so the value carries the `stale` class when `state.huntStale`. Change each per-hour `fmt` to, e.g. for XP/h:

```js
      { key: "xpPerHour", label: "XP/h ✨", num: true, fmt: (d) => !d.huntN ? `<span class="muted">—</span>`
        : `<span class="${state.huntStale ? "stale" : ""}">${fmtCompact(d.xpPerHour)}</span>` },
```

Apply the same `stale` wrapper to `goldPerHour` and `killsPerMinV`.

- [ ] **Step 5: Verify**

Open the tool; force `state.huntStale=true` in console and `renderTable(filtered())` → per-hour cells render struck-through; hover the note → updated tooltip.

- [ ] **Step 6: Commit**

```bash
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): AI/snapshot note + stale strike-through on data divergence"
```

---

### Task 8: End-to-end validation + spec cross-check

**Files:**
- No source changes unless a bug is found. Uses a headless browser (Playwright MCP) + `assets/hunt-configs.json`.

- [ ] **Step 1: Model matches measured hunts**

Run `node scripts/hunt-model.test.mjs` → PASS. Then in the browser (tool loaded), read the rendered `kills/min` for gastly, krabby, charmander, squirtle, gloom and assert they are within ±10% of measured `{gastly:14.5(cap→15), krabby:14.7, charmander:11.3, squirtle:9.3, gloom:8.1}` (abra is a known noisy outlier; skip). Document any drift.

- [ ] **Step 2: Regression check on existing tabs**

Switch through Lucro, Lucro total, XP, Captura — confirm axes/values are unchanged (no `%`/hour leakage) and hover still shows loot + capture blocks.

- [ ] **Step 3: Params + stale behaviour**

Set XP mult 1.5 → XP/h ×1.5. Set kill-time 2 → kills/min drops. Trigger stale (simulate diff) → strike-through appears.

- [ ] **Step 4: Final commit (if any fixes)**

```bash
git add -A
git commit -m "test(hunt_optimizer): validate efficiency model end-to-end"
git push origin main
```

---

## Notes / provenance

- Model calibrated on 7 hunts; `F=1.23` fitted on the clean profiling session (krabby, charmander, squirtle, gloom) with hypno confirming the kill-time term. **Abra** from the exploratory session is ~+18% off (likely AFK/walls) — re-profile if precision matters.
- `N=15` for 239/240 hunts (one has 5); the snapshot carries real `n` per hunt.
- Capture files contain the account JWT — never commit them; they stay in `~/Downloads`/scratchpad only.

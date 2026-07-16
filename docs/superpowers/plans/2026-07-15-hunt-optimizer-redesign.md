# Hunt Optimizer v2 Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `hunt_optimizer.html` UI as a sidebar + dense-ranking layout with 3 views (XP/h, Gold/h, Captura), fixed model params, viewport-clamped popover, and PostHog analytics injected at deploy time.

**Architecture:** Incremental transformation of the existing single-file page — every task leaves `hunt_optimizer.html` working and committed. Data flow (GitHub snapshot → official-API verification) and the measured math model are carried over unchanged. A new GitHub Actions workflow deploys Pages and injects the PostHog key from a repo secret.

**Tech Stack:** Vanilla JS/CSS in one HTML file, `scripts/hunt-model.mjs` (untouched, node test as regression), Playwright MCP for browser verification, GitHub Actions + `actions/deploy-pages`.

**Spec:** `docs/superpowers/specs/2026-07-15-hunt-optimizer-redesign-design.md`

## Global Constraints

- Single self-contained HTML file, zero build, no framework, no CDN dependencies (except the PostHog snippet, which is the analytics itself).
- `scripts/hunt-model.mjs` must NOT change; `node scripts/hunt-model.test.mjs` must pass after every task.
- Catch math is the measured formula only: `rate = min(1, 3.48 · catchRate^2.05 / value^0.898)`, `value = priceNpc || sellValue`. Constants `CATCH_C = 3.48, CATCH_A = 2.05, CATCH_B = 0.898` stay verbatim.
- Model params fixed at measured defaults: `{ tileS: 0.6, respawnS: 60, F: 1.23, killTimeS: 0 }`. Only `xpMult` varies (1 or 1.5 via VIP toggle).
- Page copy stays pt-BR; code identifiers and comments in English.
- Hunt levels are exactly: 1, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 200.
- Commits: conventional prefix `feat(hunt_optimizer):` / `chore:` / `docs:`, direct to `main` (repo convention). NO Co-Authored-By trailer.
- Do NOT run destructive git commands; do NOT change GitHub Pages settings or create secrets — those two steps are user-gated (Task 8 flags them).

**Browser verification setup (used by several tasks):** serve the repo locally, then drive with Playwright MCP tools:

```bash
# background server (once per session)
python3 -m http.server 8123 -d /Users/augustopereira/dev/static-pages
```

Navigate to `http://localhost:8123/hunt_optimizer.html`, wait for the status text to contain "creatures e" (data loaded from GitHub raw — needs network). Use `browser_evaluate` for assertions.

---

### Task 1: Reduce views to XP/h, Gold/h, Captura; kill AI badges and insight

**Files:**
- Modify: `hunt_optimizer.html` (TABS config ~line 492-541; tabs markup ~line 363-373; `renderAll` ~line 903; `state.tab` ~line 479; `openDiffModal`/`clearHuntStale` ~line 646-675; CSS `.ai-badge`/`.ai-note` ~line 206-210; `buildControls` aiNote ref ~line 897; `renderInsight` ~line 913-926; insight markup ~line 282-285)

**Interfaces:**
- Produces: `state.tab ∈ {"xpHora","goldHora","captura"}`, default `"xpHora"`. `TABS` keeps keys `xpHora`, `goldHora`, `captura` only. Later tasks rely on these three keys and on `curField()` still working.

- [ ] **Step 1: Replace the tabs markup**

Replace the `<div class="tabs" ...>` block (lines 363-370) and delete the `<p class="ai-note" ...>` block (lines 371-373) entirely:

```html
  <!-- OBJETIVO -->
  <div class="tabs" id="tabs" style="display:none">
    <button data-tab="xpHora" class="active">⭐ XP/hora</button>
    <button data-tab="goldHora">💰 Gold/hora</button>
    <button data-tab="captura">🎯 Captura</button>
  </div>
```

- [ ] **Step 2: Reduce the TABS config object**

Delete the `lucro`, `xp`, and `lucroTotal` entries from `TABS`. Keep `captura`, `xpHora`, `goldHora`, dropping the "Estimado de snapshot" sentence from subs and the piwtools mention (the formula is measured now):

```js
  const TABS = {
    xpHora: {
      field: "xpPerHour", fmt: fmtCompact,
      rankTitle: "Ranking de XP por hora",
      rankSub: (n, total) => `Top ${n} de ${total}. kills/min × XP por kill, contando densidade e respawn da hunt.`,
      scatterTitle: "Esforço × XP/hora", scatterHint: "huntLevel × XP/h — cor por raridade",
      scatterSub: "Superior-esquerdo = fácil e muita XP por hora (o alvo pra grind).",
    },
    goldHora: {
      field: "goldPerHour", fmt: fmtCompact,
      rankTitle: "Ranking de Gold por hora",
      rankSub: (n, total) => `Top ${n} de ${total}. kills/min × gold por kill (loot + captura, conforme o toggle).`,
      scatterTitle: "Esforço × Gold/hora", scatterHint: "huntLevel × Gold/h — cor por raridade",
      scatterSub: "Superior-esquerdo = fácil e muito gold por hora.",
    },
    captura: {
      field: "capturePct",
      fmt: (v) => nf1.format(v) + "%",
      rankTitle: "Ranking de chance de captura",
      rankSub: (n, total) => `Top ${n} de ${total}. % da melhor ball (a que mais rende por kill), pela fórmula medida no jogo.`,
      scatterTitle: "Esforço × Captura",
      scatterHint: "huntLevel × chance de captura — cor por raridade",
      scatterSub: "Chance da melhor ball pela fórmula medida (power law no catchRate).",
    },
  };
```

- [ ] **Step 3: Update state default and remove insight/aiNote wiring**

- `state.tab: "lucro"` → `state.tab: "xpHora"` (line ~479).
- In `renderAll()` remove the line `if (state.tab === "lucro") renderInsight(); else $("insight").classList.remove("show");`.
- Delete the whole `renderInsight()` function and the `<div class="insight" id="insight">` markup block.
- In `openDiffModal()` delete the 3 lines referencing `$("aiNote")` (keep `state.huntStale = true;` and the rest).
- In `clearHuntStale()` keep only `state.huntStale = false;`.
- In `buildControls()` delete the line `$("aiNote").style.display = "inline-flex";`.
- Delete CSS rules `.ai-badge` and `.ai-note` (keep `.stale`).
- Delete CSS rules `.insight`, `.insight.show`, `.insight .icon`, `.insight b`.

- [ ] **Step 4: Verify in browser**

Serve + navigate (see Global Constraints). Assert via `browser_evaluate`:

```js
() => {
  const tabs = [...document.querySelectorAll('#tabs button')].map(b => b.dataset.tab);
  return JSON.stringify({ tabs, badges: document.querySelectorAll('.ai-badge').length,
    note: !!document.getElementById('aiNote'), insight: !!document.getElementById('insight'),
    ranking: document.getElementById('rankTitle').textContent });
}
```

Expected: `tabs = ["xpHora","goldHora","captura"]`, `badges = 0`, `note = false`, `insight = false`, ranking title = "Ranking de XP por hora". Click each tab; ranking re-renders without console errors (`browser_console_messages` clean).

- [ ] **Step 5: Regression + commit**

```bash
node scripts/hunt-model.test.mjs   # expected: "hunt-model: all assertions passed"
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): reduce views to XP/h, Gold/h, Captura; drop AI badges and insight"
```

---

### Task 2: Compute both Gold/h variants; VIP and catch toggles (state only)

**Files:**
- Modify: `hunt_optimizer.html` (`state` ~line 470-490; `compute()` per-hour block ~line 796-804; `curField()` ~line 544)

**Interfaces:**
- Consumes: `TABS` keys from Task 1.
- Produces: each computed row gains `goldPerHourNoCatch` (number). New state: `state.vip` (bool, default false) and `state.countCatch` (bool, default true). `curField()` returns `"goldPerHourNoCatch"` when `state.tab === "goldHora" && !state.countCatch`. Task 3 wires the checkboxes; Task 6 shows both values in the popover.

- [ ] **Step 1: Extend state**

In the `state` literal add:

```js
    vip: false,        // ×1.5 XP (measured VIP bonus) — drives params.xpMult
    countCatch: true,  // Gold/h ranks loot+captureNet (true) or loot only (false)
```

- [ ] **Step 2: Compute both gold variants**

In `compute()`, inside the `if (hcfg)` block, replace the `goldPerHour` line and declare the sibling:

```js
      let killsPerMinV = 0, xpPerHour = 0, goldPerHour = 0, goldPerHourNoCatch = 0, huntRoute = null, huntN = 0, regime = null;
      if (hcfg) {
        // ... existing lines unchanged ...
        goldPerHour = killsPerMinV * 60 * (lootValue + captureNet);
        goldPerHourNoCatch = killsPerMinV * 60 * lootValue;
      }
```

and add `goldPerHourNoCatch,` next to `goldPerHour` in the `out.push({...})` literal.

- [ ] **Step 3: Field resolution honors the catch toggle**

Replace `const curField = () => TABS[state.tab].field;` with:

```js
  const curField = () => (state.tab === "goldHora" && !state.countCatch)
    ? "goldPerHourNoCatch" : TABS[state.tab].field;
```

`renderRanking` and `renderScatter` read `TABS[state.tab].field` directly (lines ~961, ~1016) — change both to use `curField()` instead.

- [ ] **Step 4: Verify in browser**

State lives inside the IIFE, so verify via DOM. Click the Gold/hora tab, then `browser_evaluate`:

```js
() => JSON.stringify({
  title: document.getElementById('rankTitle').textContent,
  hasBars: document.querySelectorAll('#rankChart path, #rankChart .rrow').length > 0,
})
```

Expected: `title = "Ranking de Gold por hora"`, `hasBars = true`, console clean. The with/without-catch numeric assertion lands in Task 3 (the checkbox flips ranking values there).

- [ ] **Step 5: Regression + commit**

```bash
node scripts/hunt-model.test.mjs
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): compute Gold/h with and without captureNet; vip/countCatch state"
```

---

### Task 3: Sidebar controls semantics — level selects, unified search, VIP/catch checkboxes, remove params panel

**Files:**
- Modify: `hunt_optimizer.html` (filters markup ~line 288-349; `filtered()` ~line 834-852; `wire()` filter bindings ~line 1294-1324; `buildControls()` ~line 855-900)

**Interfaces:**
- Consumes: `state.vip`, `state.countCatch` from Task 2.
- Produces: `state.filters.hlMin/hlMax` stay numbers-or-null (now fed by selects). `state.filters.search` matches creature OR hunt name. Gone: `state.filters.huntStatus`, `state.filters.hunt`, params inputs, Top N input. `HUNT_LEVELS` const. Task 4 moves this markup into the sidebar unchanged.

- [ ] **Step 1: Replace the filters markup**

Replace the whole `<section class="card" id="filtersCard">…</section>` content (keep the section element and id) with:

```html
    <h2>Filtros</h2>
    <div class="filters">
      <div class="fgroup">
        <label>Objetivo</label>
        <!-- the #tabs div moves here in Task 4; until then tabs stay above the ranking -->
      </div>
      <div class="fgroup">
        <label>Level da hunt</label>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="hlMin"></select>
          <span class="muted">até</span>
          <select id="hlMax"></select>
        </div>
      </div>
      <div class="fgroup">
        <label>Área</label>
        <div class="seg" id="areaSeg">
          <button data-area="kanto" class="active">Kanto</button>
          <button data-area="outland">Outland</button>
          <button data-area="ALL">Todas</button>
        </div>
      </div>
      <div class="fgroup">
        <label>Buscar</label>
        <input type="text" id="search" placeholder="nome do pokémon / hunt" style="width:160px" />
      </div>
    </div>
    <div class="fgroup" style="margin-top:12px">
      <label>Raridade</label>
      <div class="chips" id="rarityChips"></div>
    </div>
    <div class="fgroup" style="margin-top:12px">
      <label>Opções</label>
      <label class="opt-check"><input type="checkbox" id="optVip" /> VIP (×1,5 XP)</label>
      <label class="opt-check"><input type="checkbox" id="optCatch" checked /> contar captura no Gold/h</label>
    </div>
```

Delete: the old `typeSel` group (type filter is gone per spec decision 4 — types are for eyeballing, and search covers the rest), `hlMin/hlMax` number inputs, Top N group, the whole `Parâmetros ✨` fgroup, the whole `huntFilters` div (huntStatusSeg + hunt input + datalist). Add CSS:

```css
  .opt-check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
```

- [ ] **Step 2: Populate level selects and rewrite `filtered()`**

Add near the top constants: `const HUNT_LEVELS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 100, 150, 200];`

In `buildControls()` replace the `typeSel` population block with:

```js
    // level selects (discrete hunt levels + "qualquer")
    const fillLv = (id, label) => {
      const sel = $(id);
      if (sel.options.length) return;
      const any = document.createElement("option");
      any.value = ""; any.textContent = label; sel.appendChild(any);
      HUNT_LEVELS.forEach((lv) => {
        const o = document.createElement("option"); o.value = lv; o.textContent = lv; sel.appendChild(o);
      });
    };
    fillLv("hlMin", "qualquer"); fillLv("hlMax", "qualquer");
```

Also in `buildControls()`: delete the `huntFilters`/`huntList` datalist block; keep the `areaSeg` active-class sync (element moved but id kept).

Rewrite `filtered()`:

```js
  function filtered() {
    const f = state.filters;
    const q = f.search.trim().toLowerCase();
    const perHour = state.tab !== "captura"; // XP/h & Gold/h need a mapped hunt
    return state.computed.filter((c) => {
      if (!f.rarity.has(c.rarity)) return false;
      if (f.hlMin != null && c.huntLevel < f.hlMin) return false;
      if (f.hlMax != null && c.huntLevel > f.hlMax) return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.huntNamesLc.some((n) => n.includes(q))) return false;
      if (state.hasMarkers) {
        if (perHour && !c.hasHunt) return false;
        // Captura view: area only constrains creatures that have hunts (spec decision 9)
        if (f.area !== "ALL" && c.hasHunt && !c.huntAreas.includes(f.area)) return false;
      }
      return true;
    });
  }
```

In the `state.filters` literal drop `type`, `huntStatus`, `hunt`; keep `rarity`, `hlMin`, `hlMax`, `search`, `area: "kanto"`.

- [ ] **Step 3: Rewire events**

In `wire()` delete the bindings for `typeSel`, `topN`, `pWalk…pKillTime` (`bindParam` and `recompute`), `huntStatusSeg`, `huntInput`. Replace the `hlMin`/`hlMax` bindings and add the toggles:

```js
    const lvVal = (v) => (v === "" ? null : Number(v));
    $("hlMin").addEventListener("change", (e) => { state.filters.hlMin = lvVal(e.target.value); renderAll(); });
    $("hlMax").addEventListener("change", (e) => { state.filters.hlMax = lvVal(e.target.value); renderAll(); });
    $("optVip").addEventListener("change", (e) => {
      state.vip = e.target.checked;
      state.params.xpMult = state.vip ? 1.5 : 1;
      tryCompute(); // xp/h is baked into computed rows
    });
    $("optCatch").addEventListener("change", (e) => { state.countCatch = e.target.checked; renderAll(); });
```

Note `state.params` stays as the fixed `{ tileS: 0.6, respawnS: 60, F: 1.23, xpMult: 1, killTimeS: 0 }` — only `xpMult` is ever written.

- [ ] **Step 4: Verify in browser**

`browser_evaluate` after load:

```js
() => JSON.stringify({
  lvOptions: [...document.querySelectorAll('#hlMin option')].map(o => o.value),
  params: !!document.getElementById('pWalk'), topN: !!document.getElementById('topN'),
  huntSeg: !!document.getElementById('huntStatusSeg'), typeSel: !!document.getElementById('typeSel'),
})
```

Expected: `lvOptions = ["","1","10","20","30","40","50","60","70","80","100","150","200"]`, all booleans false. Then interactively: set hlMin=40 → ranking only shows lv ≥ 40 creatures (hover/inspect); toggle VIP on the XP/hora tab → top value grows ×1.5; on Gold/hora uncheck "contar captura" → values drop for high-captureNet creatures (e.g. search "Krabby", compare number before/after). Console clean.

- [ ] **Step 5: Regression + commit**

```bash
node scripts/hunt-model.test.mjs
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): level selects, unified search, VIP/catch toggles; drop exposed params"
```

---

### Task 4: Page layout — header status line, sidebar grid, data card → modal

**Files:**
- Modify: `hunt_optimizer.html` (body markup ~line 235-410; layout CSS; `bootstrap`/`verifyAgainstOfficial`/`setStatus`/`showWarning` ~line 590-676)

**Interfaces:**
- Consumes: filter markup ids from Task 3 (`hlMin`, `hlMax`, `areaSeg`, `search`, `rarityChips`, `optVip`, `optCatch`), `#tabs`.
- Produces: `#dataStatus` (status line span, click opens `#dataModal`), `setDataState(state, msg)` with `state ∈ {"loading","ok","divergent","unverified"}`. Layout: `.layout` grid with `aside.sidebar` + `main.content`. Later tasks render into `#rankCard`, `#scatterCard`, `#tableCard` inside `main`.

- [ ] **Step 1: Restructure the body markup**

Replace everything between `<div class="wrap">` and the diff-modal comment with (filter/tabs inner markup is MOVED, not re-written — ids unchanged):

```html
<div class="wrap">
  <header class="top">
    <div>
      <h1>🎯 Hunt Optimizer</h1>
      <button class="statusline" id="dataStatus"><span class="dot"></span><span id="dataStatusTxt">carregando dados…</span></button>
    </div>
    <button class="theme-toggle" id="themeBtn" title="Alternar tema">🌗 Tema</button>
  </header>

  <div class="layout">
    <aside class="sidebar card" id="filtersCard" style="display:none">
      <!-- Objetivo -->
      <div class="fgroup"><label>Objetivo</label>
        <div class="tabs" id="tabs"><!-- 3 buttons, moved verbatim from old location --></div>
      </div>
      <!-- Level / Área / Buscar / Raridade / Opções: fgroups from Task 3, moved verbatim -->
    </aside>

    <main class="content">
      <section class="card" id="rankCard" style="display:none">
        <div class="chart-head"><h2 id="rankTitle">Ranking</h2></div>
        <div class="chart-sub" id="rankSub"></div>
        <div id="rankChart"></div>
      </section>
      <details class="card table-card" id="scatterCard" style="display:none">
        <summary>Esforço × valor <span class="hint" id="scatterHint"></span></summary>
        <div class="chart-head" style="margin-top:10px">
          <div class="chart-sub" id="scatterSub"></div>
          <label class="muted" style="font-size:12px;display:flex;gap:6px;align-items:center">
            <input type="checkbox" id="logY" checked /> escala log (Y)
          </label>
        </div>
        <div class="legend" id="scatterLegend"></div>
        <div id="scatterChart"></div>
      </details>
      <details class="card table-card" id="tableCard" style="display:none">
        <summary>Tabela completa <span class="hint" id="tableCount"></span></summary>
        <div class="table-wrap"><table id="table"><thead><tr id="theadRow"></tr></thead><tbody id="tbody"></tbody></table></div>
      </details>
    </main>
  </div>
</div>

<!-- data modal: status details + manual load (dropzones/paste moved verbatim, ids unchanged) -->
<div id="dataModal" class="modal-overlay" style="display:none">
  <div class="modal" style="max-width:640px">
    <h3>Dados</h3>
    <p id="dataModalBody"></p>
    <div class="source-actions">
      <button class="primary" id="reloadBtn">🔄 Verificar dados oficiais</button>
      <span class="muted" style="font-size:12px">snapshot no GitHub · confere contra poke.idleworld.online</span>
    </div>
    <div class="status" id="status"></div>
    <div id="dataWarning" class="warn-banner" style="display:none"></div>
    <details class="paste" id="manualDetails">
      <!-- dropzones + textareas + pasteBtn moved verbatim from the old data card -->
    </details>
    <div class="modal-actions" style="margin-top:14px"><button id="dataModalClose">Fechar</button></div>
  </div>
</div>
```

Notes: `scatterCard` becomes a `<details>` (collapsed by default — spec); `scatterTitle`/`scatterH2` ids die, `renderScatter` writes `#scatterHint`/`#scatterSub` only (delete the `$("scatterTitle").textContent = …` line; the summary text is static "Esforço × valor"). The diff modal (`#modal`), `#toast`, `#tip` blocks stay as-is.

- [ ] **Step 2: Layout + status-line CSS**

```css
  .layout { display: grid; grid-template-columns: 232px 1fr; gap: 16px; align-items: start; }
  .sidebar { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 14px; }
  .sidebar .filters { flex-direction: column; align-items: stretch; }
  .sidebar .tabs { display: flex; margin-bottom: 0; }
  .sidebar .tabs button { flex: 1; padding: 7px 8px; }
  @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } .sidebar { position: static; } }

  .statusline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);
    background: none; border: none; padding: 2px 0; cursor: pointer; }
  .statusline .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
  .statusline.ok .dot { background: var(--good); }
  .statusline.divergent .dot { background: #eda100; }
  .statusline.unverified .dot { background: var(--text-muted); }
  .statusline:hover { text-decoration: underline; }
```

- [ ] **Step 3: Wire the status line + modal**

Add helper and call it from the data flow (keep `setStatus`/`showWarning` writing into the modal):

```js
  function setDataState(kind, txt) {
    const el = $("dataStatus");
    el.className = "statusline " + kind;
    $("dataStatusTxt").textContent = txt;
  }
```

- `bootstrap()` start: `setDataState("loading", "carregando dados…")`.
- Snapshot loaded OK (after `tryCompute()`): `setDataState("loading", "verificando dados oficiais…")`.
- `verifyAgainstOfficial()` success/no-diff: `setDataState("ok", "dados verificados agora")`.
- Proxy failure branch: `setDataState("unverified", "não foi possível verificar — usando snapshot")`.
- `openDiffModal()`: `setDataState("divergent", "dados oficiais divergem do snapshot")`.
- Modal-recalc handler: `setDataState("ok", "recalculado com dados oficiais")`.
- Wire clicks: `$("dataStatus")` opens `#dataModal` (set `$("dataModalBody").textContent` to the last full status text); `$("dataModalClose")` closes it. Delete `setSource`/`$("dataMeta")` (element gone) — replace its call sites with nothing.
- Delete the old `header.top p` subtitle and its CSS if now unused.

- [ ] **Step 4: Verify in browser**

Desktop 1280px: sidebar left (sticky on scroll), ranking right, scatter and table collapsed. `browser_resize` to 390px: sidebar stacks above content. Status line goes `carregando… → verificando… → ●verde "dados verificados agora"` (or amber modal if snapshot diverges — both acceptable). Click status line → modal opens with reload button + manual load; close works. Console clean.

- [ ] **Step 5: Regression + commit**

```bash
node scripts/hunt-model.test.mjs
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): sidebar layout, header status line, data card to modal"
```

---

### Task 5: Ranking as dense DOM chart with type squares

**Files:**
- Modify: `hunt_optimizer.html` (`renderRanking` ~line 957-1009; new `TYPE_COLORS`; new CSS; `state.topN` default)

**Interfaces:**
- Consumes: `curField()` (Task 2), `#rankChart` inside `main` (Task 4), `showTip/hideTip` (existing; rewritten in Task 6 with same signature).
- Produces: `TYPE_COLORS` map (used again by Task 6 popover and Task 7 table), `typeSquares(d)` helper returning HTML for a creature's type squares, rows carry `data-id` matching `computed[].id`.

- [ ] **Step 1: Type palette + CSS**

```js
  // Standard Pokémon type palette; keys match creatures.json type1/type2 values.
  const TYPE_COLORS = {
    NORMAL: "#A8A77A", FIRE: "#EE8130", WATER: "#6390F0", ELECTRIC: "#F7D02C",
    GRASS: "#7AC74C", ICE: "#96D9D6", FIGHTING: "#C22E28", POISON: "#A33EA1",
    GROUND: "#E2BF65", FLYING: "#A98FF3", PSYCHIC: "#F95587", BUG: "#A6B91A",
    ROCK: "#B6A136", GHOST: "#735797", DRAGON: "#6F35FC", DARK: "#705746",
    STEEL: "#B7B7CE", FAIRY: "#D685AD",
  };
  const typeSquares = (d) => [d.type1, d.type2].filter(Boolean).map((t) =>
    `<span class="tsq" style="background:${TYPE_COLORS[t] || "var(--text-muted)"}" title="${t}"></span>`).join("");
```

```css
  .tsq { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 3px; vertical-align: baseline; }
  .rrow { display: grid; grid-template-columns: 22px minmax(90px, 150px) 34px 1fr 56px; gap: 8px;
    align-items: center; padding: 3px 8px; border-radius: 6px; font-size: 12.5px; cursor: default; }
  .rrow:hover { background: var(--accent-soft); }
  .rrow .rk { color: var(--text-muted); font-size: 10.5px; text-align: right; font-variant-numeric: tabular-nums; }
  .rrow .nm { color: var(--text-primary); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rrow .track { height: 12px; background: var(--grid); border-radius: 4px; overflow: hidden; }
  .rrow .track i { display: block; height: 100%; background: var(--series-1); border-radius: 4px; min-width: 1px; }
  .rrow .val { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-primary); font-size: 12px; }
  .rrow.stale .track i, .rrow.stale .val { opacity: .55; text-decoration: line-through; }
  .show-more { margin: 8px auto 0; display: block; }
```

- [ ] **Step 2: Rewrite `renderRanking` as DOM rows**

Replace the whole SVG-based `renderRanking` with:

```js
  function renderRanking(data) {
    const host = $("rankChart");
    clear(host);
    const cfg = TABS[state.tab];
    const field = curField();
    const valFmt = cfg.fmt || fmtCompact;
    const sorted = [...data].sort((a, b) => b[field] - a[field]);
    const shown = sorted.slice(0, state.topN);
    $("rankTitle").textContent = cfg.rankTitle;
    $("rankSub").textContent = cfg.rankSub(shown.length, data.length);
    if (!shown.length) { host.innerHTML = '<div class="empty">Nenhum monstro no filtro.</div>'; return; }
    const maxV = Math.max(1e-9, shown[0][field]);
    const stale = state.huntStale && state.tab !== "captura";
    for (let i = 0; i < shown.length; i++) {
      const d = shown[i];
      const row = document.createElement("div");
      row.className = "rrow" + (stale ? " stale" : "");
      row.dataset.id = d.id;
      row.innerHTML =
        `<span class="rk">${i + 1}</span>` +
        `<span class="nm">${escHtml(d.name)}</span>` +
        `<span>${typeSquares(d)}</span>` +
        `<span class="track"><i style="width:${Math.max(0.8, (d[field] / maxV) * 100)}%"></i></span>` +
        `<span class="val">${valFmt(d[field])}</span>`;
      row.addEventListener("mousemove", (ev) => showTip(ev, tipCreature(d)));
      row.addEventListener("mouseleave", hideTip);
      host.appendChild(row);
    }
    if (sorted.length > state.topN) {
      const btn = document.createElement("button");
      btn.className = "show-more";
      btn.textContent = `mostrar mais (${sorted.length - state.topN} restantes)`;
      btn.addEventListener("click", () => { state.topN += 25; renderAll(); });
      host.appendChild(btn);
    }
  }
```

Set `state.topN` default to `25`. Reset paging when context changes — in the tab-click handler and in each filter handler that calls `renderAll()`, set `state.topN = 25;` first (add a small helper `const resetPaging = () => { state.topN = 25; };` and call it in the tab, level, area, search, rarity-chip and optCatch handlers).

- [ ] **Step 3: Verify in browser**

XP/hora tab: 25 rows, row 1 has the widest bar and the biggest value, type squares visible (e.g. Gastly shows two squares), "mostrar mais" appends 25 more. Captura tab with Área=Todas: creatures without hunts also appear (spec decision 9). Hover any row → popover appears. Dark theme: rows legible. Console clean.

- [ ] **Step 4: Regression + commit**

```bash
node scripts/hunt-model.test.mjs
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): dense DOM ranking with type squares and show-more paging"
```

---

### Task 6: Popover — new content, viewport clamp, mobile tap

**Files:**
- Modify: `hunt_optimizer.html` (`tipCreature` ~line 1094-1145; `showTip/hideTip` ~line 1224-1235; `#tip` CSS ~line 167-231)

**Interfaces:**
- Consumes: `goldPerHourNoCatch` (Task 2), `TYPE_COLORS`/`typeSquares` (Task 5), rows with `data-id` (Task 5).
- Produces: `showTip(ev, html)` / `hideTip()` same signatures (table rows and scatter dots keep working). Popover clamps to viewport on all sides.

- [ ] **Step 1: Rewrite `tipCreature` content**

Replace the header rows of `tipCreature(d)` (keep `capHtml` per-ball list and loot `breakHtml` structure, with one change: fold `captura·venda` into the gold breakdown):

```js
  function tipCreature(d) {
    // gold breakdown: loot items + capture·sell as one comparable list
    const rows = d.breakdown.filter((b) => b.contribution > 0).map((b) => ({
      name: b.name, gold: b.contribution, sub: `${b.min}–${b.max} un · ${nf1.format(b.chance * 100)}% · ${nf0.format(b.price)} gold/un` }));
    if (d.captureNet > 0) rows.push({ name: "captura · venda", gold: d.captureNet,
      sub: `${nf1.format(d.capturePct)}% de ${nf0.format(d.sellValue)} − ball ${nf0.format(d.bestBall.price)}` });
    rows.sort((a, b) => b.gold - a.gold);
    const shown = rows.slice(0, 7);
    const maxC = shown.length ? shown[0].gold : 1;
    const goldHtml = shown.map((r) =>
      `<div class="t-bar-item"><div class="t-bar-row">` +
        `<span class="t-bar-name" title="${escHtml(r.name)}">${escHtml(r.name)}</span>` +
        `<span class="t-bar-track"><span class="t-bar-fill" style="width:${Math.max(4, (r.gold / maxC) * 100)}%"></span></span>` +
        `<span class="t-bar-val">${nf1.format(r.gold)}</span>` +
      `</div><div class="t-bar-sub">${r.sub}</div></div>`).join("");
    const moreHtml = rows.length > 7 ? `<div class="t-more">+ ${rows.length - 7} outros drops menores</div>` : "";
    const breakHtml = shown.length
      ? `<div class="t-break"><div class="t-break-title">De onde vem o gold (por kill)</div>${goldHtml}${moreHtml}</div>` : "";
    const capHtml = d.sellValue > 0
      ? `<div class="t-break"><div class="t-break-title">Chance de captura por ball</div>` +
          BALLS.map((b) => {
            const pct = (d.captureRates[b.key] || 0) * 100;
            const isBest = b.key === d.bestBall.key;
            const tag = isBest ? " ⭐" : (b.buyable ? "" : ` <span class="muted" style="font-size:10px">·evento</span>`);
            return `<div class="t-bar-item"><div class="t-bar-row">` +
              `<span class="t-bar-name">${b.name}${tag}</span>` +
              `<span class="t-bar-track"><span class="t-bar-fill" style="width:${Math.max(2, pct)}%;background:var(--series-1)"></span></span>` +
              `<span class="t-bar-val">${nf1.format(pct)}%</span>` +
            `</div></div>`;
          }).join("") +
        `</div>`
      : "";
    const per = d.huntN
      ? `<div class="t-row"><span>kills/min</span><b>${nf1.format(d.killsPerMinV)} (${d.regime === "respawn" ? "respawn-lim." : "tamanho-lim."})</b></div>` +
        `<div class="t-row"><span>XP/hora${state.vip ? " (VIP)" : ""}</span><b>${fmtCompact(d.xpPerHour)}</b></div>` +
        `<div class="t-row"><span>Gold/hora com catch</span><b>${fmtCompact(d.goldPerHour)}</b></div>` +
        `<div class="t-row"><span>Gold/hora sem catch</span><b>${fmtCompact(d.goldPerHourNoCatch)}</b></div>` +
        `<div class="t-bar-sub">volta ~${nf0.format(d.huntRoute)} tiles · ${d.huntN} spawns · respawn ${state.params.respawnS}s · estimado de snapshot das hunts</div>`
      : `<div class="t-bar-sub">sem hunt mapeada — sem métricas por hora</div>`;
    return `<div class="t-name">${escHtml(d.name)} ${typeSquares(d)}</div>` +
      `<div class="t-row"><span>raridade · level</span><b>${d.rarity} · lv ${d.huntLevel}</b></div>` +
      (state.hasMarkers && d.hasHunt ? `<div class="t-row"><span>área</span><b>${escHtml(d.huntAreas.join(", "))}</b></div>` : "") +
      `<div class="t-row"><span>XP por kill</span><b>${nf0.format(d.experience)}</b></div>` +
      `<div class="t-row"><span>loot / kill · venda</span><b>${nf1.format(d.lootValue)} · ${nf0.format(d.sellValue)}</b></div>` +
      per + capHtml + breakHtml;
  }
```

(The `capHtml` per-ball block is the existing code from lines 1112-1126 — keep it verbatim, it already marks ⭐ best and `·evento` for Idle.)

- [ ] **Step 2: Clamp positioning + mobile tap**

Replace `showTip`/`hideTip` and add tap support:

```js
  const tip = $("tip");
  function showTip(ev, html) {
    tip.innerHTML = html;
    tip.style.opacity = "1";
    const pad = 12, m = 6;
    const vw = window.innerWidth, vh = window.innerHeight;
    tip.style.maxHeight = (vh - 2 * m) + "px";
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > vw - m) x = ev.clientX - r.width - pad;   // flip left
    if (x < m) x = m;                                            // clamp left edge
    if (y + r.height > vh - m) y = vh - r.height - m;            // slide up
    if (y < m) y = m;                                            // clamp top
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.style.opacity = "0"; }
  // mobile: tap a ranking row toggles the popover; tap elsewhere closes
  document.addEventListener("click", (e) => {
    if (!window.matchMedia("(hover: hover)").matches) {
      const row = e.target.closest(".rrow, tbody tr");
      if (!row) hideTip();
    }
  });
```

CSS changes on `#tip`: add `overflow-y: auto; max-width: min(380px, calc(100vw - 12px));` and keep `pointer-events: none` (hover) — but on touch devices allow scroll: add media rule `@media (hover: none) { #tip { pointer-events: auto; } }`.

Ranking rows get tap support (Task 5 already binds `mousemove`, which mobile browsers fire on tap; the document handler above closes it on outside tap).

- [ ] **Step 3: Verify in browser (the corner cases — this fixes the reported bug)**

At 1280×800: hover row 1 (top of list) and the LAST visible row (bottom of viewport); popover must be fully inside — `browser_evaluate`:

```js
() => { const r = document.getElementById('tip').getBoundingClientRect();
  return JSON.stringify({ in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, r }); }
```

Repeat on a row hovered near the right edge of the bar (mouse at x ≈ innerWidth−20) and with the Gold/hora tab active (breakdown includes "captura · venda" row for e.g. Krabby; both gold/hora lines com/sem catch visible). Expected `in: true` in all four probes.

- [ ] **Step 4: Regression + commit**

```bash
node scripts/hunt-model.test.mjs
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): rich popover with dual gold/h + full viewport clamp and mobile tap"
```

---

### Task 7: Secondary sections — scatter uses curField, table columns realigned

**Files:**
- Modify: `hunt_optimizer.html` (`renderScatter` ~line 1012-1090; `cols()` ~line 1149-1179; `state.sort` default ~line 486)

**Interfaces:**
- Consumes: `curField()` (Task 2), `TYPE_COLORS`/`typeSquares` (Task 5), `<details id="scatterCard">` (Task 4).
- Produces: final table column set. Nothing downstream.

- [ ] **Step 1: Scatter adjustments**

In `renderScatter`: `const field = curField();` (done in Task 2 — confirm), delete the `$("scatterTitle").textContent = cfg.scatterTitle;` line (element gone since Task 4); `#scatterHint`/`#scatterSub` keep being written. Everything else unchanged.

- [ ] **Step 2: Table columns**

Replace `cols()` base array with:

```js
    const base = [
      { key: "name", label: "Monstro", l: true, fmt: (d) => d.name },
      { key: "rarity", label: "Raridade", l: true, fmt: (d) => `<span class="rar"><span class="dot" style="background:var(--rar-${d.rarity})"></span>${d.rarity}</span>` },
      { key: "type1", label: "Tipo", l: true, fmt: (d) => typeSquares(d) + " " + d.type1 + (d.type2 ? "/" + d.type2 : "") },
      { key: "huntLevel", label: "Level", num: true, fmt: (d) => nf0.format(d.huntLevel) },
      { key: "killsPerMinV", label: "Kills/min", num: true, fmt: (d) => !d.huntN ? `<span class="muted">—</span>`
        : `<span class="${state.huntStale ? "stale" : ""}">${nf1.format(d.killsPerMinV)}</span>` },
      { key: "xpPerHour", label: "XP/h", num: true, fmt: (d) => !d.huntN ? `<span class="muted">—</span>`
        : `<span class="${state.huntStale ? "stale" : ""}">${fmtCompact(d.xpPerHour)}</span>` },
      { key: "goldPerHour", label: "Gold/h", num: true, fmt: (d) => !d.huntN ? `<span class="muted">—</span>`
        : `<span class="${state.huntStale ? "stale" : ""}">${fmtCompact(state.countCatch ? d.goldPerHour : d.goldPerHourNoCatch)}</span>` },
      { key: "capturePct", label: "Captura", num: true, fmt: (d) =>
        d.sellValue > 0
          ? `${nf1.format(d.capturePct)}% <span class="muted">${escHtml(d.bestBall.name)}</span>`
          : `<span class="muted">—</span>` },
      { key: "topLoot", label: "Maior drop", l: true, fmt: (d) => `<span class="muted">${escHtml(d.topLoot)}</span>` },
    ];
```

Keep the `hasMarkers` splice for the Hunt/área column (adjust splice index to 4 so it lands after Level). Set `state.sort` default to `{ key: "xpPerHour", dir: "desc" }`.

- [ ] **Step 3: Verify in browser**

Open "Tabela completa": columns exactly `Monstro, Raridade, Tipo, Level, Hunt, Kills/min, XP/h, Gold/h, Captura, Maior drop`; sort by Gold/h desc works; unchecking "contar captura" changes Gold/h cell values after a re-render (toggle + reopen). Scatter: open the details, points render for the active objetivo, log toggle works. Console clean.

- [ ] **Step 4: Regression + commit**

```bash
node scripts/hunt-model.test.mjs
git add hunt_optimizer.html
git commit -m "feat(hunt_optimizer): realign table columns to per-hour model; scatter in collapsed card"
```

---

### Task 8: PostHog snippet + Pages deploy workflow (secret injection)

**Files:**
- Modify: `hunt_optimizer.html` (`<head>`)
- Create: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: `__POSTHOG_KEY__` placeholder contract between the HTML and the workflow. USER-GATED follow-ups (do NOT execute — ask): create `POSTHOG_KEY` secret, flip Pages build type to GitHub Actions.

- [ ] **Step 1: Guarded PostHog snippet in `<head>`**

Add before `</head>` (placeholder is replaced by the workflow; guard skips init when unreplaced, e.g. opened locally):

```html
<script>
  (function () {
    var KEY = "__POSTHOG_KEY__";
    if (!/^phc_/.test(KEY)) return; // placeholder not injected → analytics off
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init(KEY, { api_host: "https://us.i.posthog.com", defaults: "2025-05-24" });
  })();
</script>
```

- [ ] **Step 2: Create the deploy workflow**

`.github/workflows/deploy-pages.yml`:

```yaml
name: Deploy Pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - name: Inject PostHog key
        env:
          POSTHOG_KEY: ${{ secrets.POSTHOG_KEY }}
        run: |
          if [ -n "$POSTHOG_KEY" ]; then
            sed -i "s/__POSTHOG_KEY__/$POSTHOG_KEY/g" hunt_optimizer.html
          fi
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Verify locally**

```bash
# guard works: opening the local file must NOT call posthog (placeholder intact)
grep -c "__POSTHOG_KEY__" hunt_optimizer.html          # expected: 1
# workflow sed does what we think:
tmp=$(mktemp) && cp hunt_optimizer.html "$tmp" && sed -i '' "s/__POSTHOG_KEY__/phc_TESTKEY/g" "$tmp" && grep -c "phc_TESTKEY" "$tmp"  # expected: 1
```

Browser check: page loads with zero console errors and no network request to `posthog.com` (placeholder guard). `actionlint` if available (`brew list actionlint`), otherwise skip.

- [ ] **Step 4: Commit**

```bash
git add hunt_optimizer.html .github/workflows/deploy-pages.yml
git commit -m "feat(hunt_optimizer): guarded PostHog snippet + Pages deploy workflow with secret injection"
```

- [ ] **Step 5: USER-GATED — do not execute, ask the user**

Present to the user (in this order, after the commit above is pushed):
1. `gh secret set POSTHOG_KEY` — needs the real `phc_…` key from their PostHog project (only they have it).
2. Flip Pages build type: `gh api -X PUT repos/AugustoAmaral/static-pages/pages -f build_type=workflow` — changes deployment for the whole site; requires explicit confirmation.
3. Push + confirm the workflow run deploys and the served page contains the key: `curl -s https://augustoamaral.github.io/static-pages/hunt_optimizer.html | grep -c phc_`.

---

### Task 9: Final E2E pass + docs sync

**Files:**
- Modify: `docs/game-mechanics.md` (§6 UI section, lines ~140-150)
- Verify: `hunt_optimizer.html`

**Interfaces:** none (terminal task).

- [ ] **Step 1: Update game-mechanics.md §6**

Replace the tab list (💰 Lucro… / 💵… / ⭐ XP / ✨ XP/hora…) with the new UI description:

```markdown
## 6. UI (`hunt_optimizer.html`)

Sidebar (objetivo, level selects, área, raridade, VIP ×1.5, contar captura, busca) +
dense ranking (type-colored rows, top-25 paging). Views: **XP/hora**, **Gold/hora**
(with/without captureNet via toggle), **Captura** (measured formula, best ball).
Model params fixed at the measured defaults (§3); only xpMult is user-visible (VIP).
Detail popover per creature: kills/min + regime, both Gold/h variants, per-ball
capture rates, unified gold breakdown (loot + captura·venda). Data: GitHub snapshot →
official-API verification → divergence modal + stale strike-through (unchanged).
```

- [ ] **Step 2: Full E2E matrix (Playwright)**

At 1280×800 and 390×844, light and dark themes:
1. Load → status line reaches a terminal state (ok/divergent/unverified).
2. Each objetivo renders a ranking; values change between them.
3. Level 40→80 filter narrows the list; "qualquer" restores.
4. VIP toggle: XP/hora top value ×1.5 exactly (compare numbers).
5. Catch toggle: Gold/hora re-ranks; popover always shows both variants.
6. Popover fully in-viewport at top row, bottom row, right edge (Task 6 probe).
7. Scatter and Tabela open/close; table sorts.
8. Manual-load modal opens from the status line.
9. `browser_console_messages`: no errors anywhere in the matrix.

- [ ] **Step 3: Regression + commit**

```bash
node scripts/hunt-model.test.mjs
git add docs/game-mechanics.md
git commit -m "docs: sync game-mechanics UI section with hunt optimizer v2"
```

- [ ] **Step 4: Push (after user OK) and hand back**

`git push origin main` — then Task 8 Step 5's user-gated checklist (secret, Pages flip, deploy check).

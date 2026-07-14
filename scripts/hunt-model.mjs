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

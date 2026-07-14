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

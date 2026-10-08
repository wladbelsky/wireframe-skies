// Peace: the flight holds formation, changes altitude and heading, the map changes under it, the origin recentres
const { test, expect } = require('./support/harness');

test('20 minutes of peace: formation, altitude changes, new landscape, floating origin', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const out = { violations: [], slotErr: [], alts: [], land: 0, sea: 0, headings: [], rolls: 0, seaRun: 0, longestSea: 0, crossings: 0, prev: null };
    const sl = new THREE.Vector3();
    __t.sim(30, { audio: false });
    for (let k = 0; k < 1170; k++) {             // 19.5 min, one sample per second
      const res = __t.sim(1, { audio: false }); out.violations.push(...res.violations);
      for (const p of SQUAD.planes.slice(1)) if (!p.maneuvering) out.slotErr.push(ROUTE.slot(FORMATIONS[SQUAD.form][p.idx], sl).distanceTo(p.pos));
      out.alts.push(ROUTE.alt); out.headings.push(ROUTE.heading);
      const over = TERRAIN.land(ROUTE.pos.x, ROUTE.pos.z) > 0;
      if (over) { out.land++; out.seaRun = 0; } else { out.sea++; out.longestSea = Math.max(out.longestSea, ++out.seaRun); }
      if (out.prev !== null && over !== out.prev) out.crossings++; out.prev = over;
      if (SQUAD.planes.some(p => p.maneuvering)) out.rolls++;
    }
    out.slotErr.sort((a, b) => a - b);
    return { violations: out.violations.slice(0, 10), p50: out.slotErr[Math.floor(out.slotErr.length * 0.5)], p95: out.slotErr[Math.floor(out.slotErr.length * 0.95)],
      altRange: Math.max(...out.alts) - Math.min(...out.alts), headRange: Math.max(...out.headings) - Math.min(...out.headings),
      land: out.land, sea: out.sea, longestSea: out.longestSea, crossings: out.crossings, shifts: WORLD.shifts, rolls: out.rolls, enemies: ENEMIES.spawned, modes: SQUAD.planes.map(p => p.mode) };
  });
  expect(r.violations).toEqual([]);
  expect(r.p50, 'median distance from the formation slot').toBeLessThan(6);
  expect(r.p95, '95th percentile distance from the slot').toBeLessThan(30);
  expect(r.altRange, 'altitude changes').toBeGreaterThan(40);
  expect(r.headRange, 'the route turns').toBeGreaterThan(0.5);
  expect(r.land, 'flies over land').toBeGreaterThan(10);
  expect(r.sea, 'flies over sea').toBeGreaterThan(10);
  expect(r.longestSea, 'seconds of open sea in a row (the route heads for a coast)').toBeLessThan(200);
  expect(r.crossings, 'coastlines crossed').toBeGreaterThan(8);
  expect(r.shifts, 'the floating origin recentred').toBeGreaterThan(5);
  expect(r.rolls, 'the odd roll / loop in peace').toBeGreaterThan(0);
  expect(r.enemies, 'no enemies without music').toBe(0);
  expect(r.modes).toEqual(['form', 'form', 'form', 'form']);
});

test('every maneuver keeps the basis orthonormal and returns control', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const out = {};
    for (const name of Object.keys(MANEUVERS)) {
      const p = new Plane({ speed: 30 }); p.place(new THREE.Vector3(0, TERRAIN.height(0, 0) + 110, 0), 0.3, 0);
      p.maneuver(name, MANEUVERS[name].segs(30, 1));
      let t = 0, ortho = 0, minY = Infinity;
      while (p.maneuvering && t < 20) { p.steer(new THREE.Vector3(0, 0, 1), 0.05); p.move(0.05); t += 0.05; ortho = Math.max(ortho, Math.abs(p.dir.dot(p.up))); minY = Math.min(minY, p.agl); }
      out[name] = { t: +t.toFixed(2), ortho, minY: +minY.toFixed(1), done: !p.maneuvering };
    }
    return out;
  });
  for (const [k, v] of Object.entries(r)) {
    expect(v.done, `${k} ends`).toBe(true);
    expect(v.ortho, `${k} basis`).toBeLessThan(1e-6);
    expect(v.minY, `${k} stays above the floor`).toBeGreaterThan(16);
  }
  expect(r.loop.t).toBeGreaterThan(6);
});

test('steering never flies into the ground, even when told to', async ({ wp }) => {
  await wp.boot();
  const minY = await wp.run(() => {
    const p = new Plane({ speed: 32, turnRate: 0.5 }); p.place(new THREE.Vector3(0, TERRAIN.height(0, 0) + 80, 0), 0, -0.9); p.rateMul = 1;
    let m = Infinity; const down = new THREE.Vector3(0, -1, 0.2).normalize();
    for (let i = 0; i < 600; i++) { p.rateMul = 1; p.steer(down, 0.05); p.move(0.05); m = Math.min(m, p.agl); }
    return m;
  });
  expect(minY, 'lowest height above the ground (the floor is 16, the last-resort clamp 9.6)').toBeGreaterThan(12);
});

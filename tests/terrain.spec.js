// Terrain: the JS fields match what the ground shader draws (ground units stand on the land / sea you see),
// the fields tile with NOISE_P, and the floating origin doesn't change the map
const { test, expect } = require('./support/harness');

test('the ground shader and TERRAIN agree on land / sea (also after origin shifts)', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const out = [];
    // fly to a steep coast so both land and sea are on screen
    for (let i = 0; i < 4000; i++) {
      const x = ROUTE.pos.x + (Math.random() - 0.5) * 30000, z = ROUTE.pos.z + (Math.random() - 0.5) * 30000;
      if (Math.abs(TERRAIN.land(x, z)) < 0.01 && Math.abs(TERRAIN.land(x + 40, z) - TERRAIN.land(x - 40, z)) > 0.04) { WORLD.origin.x += x - ROUTE.pos.x; WORLD.origin.z += z - ROUTE.pos.z; break; }
    }
    __t.sim(2); CAM.cur.el = 60; CAM.place();
    out.push(__t.groundCheck(1200));
    WORLD.origin.x += 123456789; WORLD.origin.z -= 98765432;   // far away: wrapped origin, precision
    __t.sim(2); CAM.cur.el = 60; CAM.place();
    out.push(__t.groundCheck(1200));
    return out;
  });
  for (const c of r) {
    expect(c.n, 'pixels compared: ' + JSON.stringify(r)).toBeGreaterThan(300);
    expect(c.bad, JSON.stringify(c.cases)).toBeLessThanOrEqual(Math.ceil(c.n * 0.005));
  }
});

test('fields tile with NOISE_P and a recentre keeps the map in place', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    let tile = 0;
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * NOISE_P, z = Math.random() * NOISE_P;
      tile = Math.max(tile, Math.abs(landField(x, z) - landField(wrapP(x + NOISE_P * 3), wrapP(z - NOISE_P * 7))));
    }
    const pts = Array.from({ length: 50 }, () => [rand(-1000, 1000), rand(-1000, 1000)]);
    const before = pts.map(([x, z]) => TERRAIN.land(x, z));
    const dx = 1700, dz = -1600; WORLD.recenter(dx, dz);
    const after = pts.map(([x, z]) => TERRAIN.land(x - dx, z - dz));
    return { tile, moved: Math.max(...before.map((b, i) => Math.abs(b - after[i]))), shifts: WORLD.shifts };
  });
  expect(r.tile).toBeLessThan(1e-9);
  expect(r.moved).toBeLessThan(1e-9);
  expect(r.shifts).toBe(1);
});

test('terrain height: 0 at sea, rising inland, mountains within reach of the flight', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    let seaMax = 0, landMax = 0, landN = 0, jump = 0;
    for (let i = 0; i < 6000; i++) {
      const x = rand(-30000, 30000), z = rand(-30000, 30000), l = TERRAIN.land(x, z), h = TERRAIN.height(x, z);
      if (l <= 0) seaMax = Math.max(seaMax, Math.abs(h)); else { landMax = Math.max(landMax, h); landN++; }
      jump = Math.max(jump, Math.abs(TERRAIN.height(x + 4, z) - h));   // no cliffs: smooth over a few units
    }
    return { seaMax, landMax, landN, jump };
  });
  expect(r.seaMax).toBe(0);
  expect(r.landN).toBeGreaterThan(1000);
  expect(r.landMax, 'there are hills / mountains').toBeGreaterThan(20);
  expect(r.landMax, 'mountains stay below the route clearance range').toBeLessThan(150);
  expect(r.jump).toBeLessThan(6);
});

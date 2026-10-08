// Long run: alternating music and silence for 40 simulated minutes with rendering — no geometry leaks, bounded pools,
// a bounded number of draw calls
const { test, expect } = require('./support/harness');

test('40 minutes of fights and lulls: no leaks, bounded pools and draw calls', async ({ wp }) => {
  test.setTimeout(15 * 60 * 1000);
  await wp.boot();
  const r = await wp.run(() => {
    const v = [], samples = [];
    let maxCalls = 0, maxLines = 0, maxGlow = 0;
    for (let cycle = 0; cycle < 8; cycle++) {
      for (let k = 0; k < 18; k++) {               // 3 min of music, 2 min of silence, rendering every 10 s
        v.push(...__t.sim(10, { audio: k < 18 * 0.6 }).violations);
        draw(); maxCalls = Math.max(maxCalls, renderer.info.render.calls); maxLines = Math.max(maxLines, LINES.n); maxGlow = Math.max(maxGlow, GLOW.n);
      }
      samples.push(__t.geometries());
    }
    return { v: v.slice(0, 10), samples, maxCalls, maxLines, maxGlow, s: __t.stats(), slots: Object.fromEntries(Object.entries(ENEMIES.slots).map(([k, p]) => [k, p.length])) };
  });
  expect(r.v).toEqual([]);
  expect(r.s.kills).toBeGreaterThan(50);
  for (const g of r.samples) expect(g.leaked, JSON.stringify(g.leakedTypes)).toBe(0);
  const reach = r.samples.map(g => g.reach), gpu = r.samples.map(g => g.gpu);
  expect(Math.max(...reach.slice(4)), `reachable geometries plateau: ${reach}`).toBeLessThanOrEqual(Math.max(...reach.slice(0, 4)) + 40);
  expect(Math.max(...gpu.slice(4)), `GPU geometries plateau: ${gpu}`).toBeLessThanOrEqual(Math.max(...gpu.slice(0, 4)) + 40);
  expect(r.maxCalls, 'draw calls per frame').toBeLessThan(200);
  expect(r.maxLines).toBeLessThan(3000);
  expect(r.maxGlow).toBeLessThan(900);
});

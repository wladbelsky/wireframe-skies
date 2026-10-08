// Rendering: the grid is drawn, the flight is green on screen, enemies are red in combat; both camera modes frame it
const { test, expect } = require('./support/harness');

/* brightest pixel of a box around a world point: [r, g, b] */
async function around(wp, who) {
  return wp.run((who) => {
    draw();
    const p = who === 'friend' ? SQUAD.planes[0].pos : ENEMIES.list.find(e => e.alive && e.plane && __t.screen(e.pos)) ?.pos;
    if (!p) return null;
    const s = __t.screen(p); if (!s || s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) return null;
    const gl = renderer.getContext(), c = renderer.domElement, k = c.width / innerWidth, R = 14;
    const x0 = Math.max(0, Math.round((s.x - R) * k)), y0 = Math.max(0, Math.round(c.height - (s.y + R) * k)), w = Math.round(2 * R * k), h = w;
    const buf = new Uint8Array(w * h * 4); gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let best = [0, 0, 0], bs = -1; for (let i = 0; i < buf.length; i += 4) { const sc = who === 'friend' ? buf[i + 1] - buf[i] : buf[i] - buf[i + 2]; if (sc > bs) { bs = sc; best = [buf[i], buf[i + 1], buf[i + 2]]; } }
    return best;
  }, who);
}

for (const cam of ['cinematic', 'fixed']) {
  test(`${cam} camera: grid, green flight, red enemies`, async ({ wp }) => {
    await wp.boot({ query: '?cam=' + cam });
    await wp.sim(20, { audio: false });
    const grid = await wp.run(() => { draw(); const a = __t.sample(0, innerHeight * 0.5, innerWidth, innerHeight * 0.5); return a; });
    expect(grid[2], 'the ground is not empty: blue grid / dots').toBeGreaterThan(14);
    const f = await around(wp, 'friend');
    expect(f, 'lead on screen').toBeTruthy();
    expect(f[1], 'green').toBeGreaterThan(150); expect(f[1]).toBeGreaterThan(f[0] + 60);
    const onScreen = await wp.run(() => SQUAD.planes.filter(p => { const s = __t.screen(p.pos); return s && s.x > 0 && s.y > 0 && s.x < innerWidth && s.y < innerHeight; }).length);
    expect(onScreen, 'the whole flight is framed in peace').toBe(4);
    await wp.run(() => __t.forceFight());
    let e = null;
    for (let i = 0; i < 30 && !e; i++) { await wp.sim(2, { audio: true }); e = await around(wp, 'enemy'); }
    expect(e, 'an enemy aircraft on screen during combat').toBeTruthy();
    expect(e[0], 'red').toBeGreaterThan(150); expect(e[0]).toBeGreaterThan(e[2] + 60);
  });
}

test('the hero plane stays on screen during combat', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight(); __t.sim(15, { audio: true });
    let on = 0, n = 0;
    for (let k = 0; k < 120; k++) { __t.sim(1, { audio: true }); const s = __t.screen(CAM.hero.pos); n++; if (s && s.x > 0 && s.y > 0 && s.x < innerWidth && s.y < innerHeight) on++; }
    return on / n;
  });
  expect(r).toBeGreaterThan(0.9);
});

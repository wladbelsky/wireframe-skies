// Rendering: the grid is drawn, the flight is green on screen, enemies are red in combat; both camera modes frame it
const { test, expect } = require('./support/harness');

/* brightest pixel of a box around a world point: [r, g, b] */
async function around(wp, who) {
  return wp.run((who) => {
    draw();
    const on = p => { const s = __t.screen(p); return s && s.x > 20 && s.y > 20 && s.x < innerWidth - 20 && s.y < innerHeight - 20; };
    const p = who === 'friend' ? SQUAD.planes[0].pos : ENEMIES.list.find(e => e.alive && on(e.pos)) ?.pos;
    if (!p) return null;
    const s = __t.screen(p); if (!s || s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) return null;
    const c = renderer.domElement, k = c.width / innerWidth, R = 14;
    const x0 = Math.max(0, Math.round((s.x - R) * k)), y0 = Math.max(0, Math.round((s.y - R) * k)), w = Math.round(2 * R * k), h = w;
    const buf = __t.pixels(x0, y0, w, h);
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
    expect(e, 'an enemy on screen during combat').toBeTruthy();
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

test('a new unit appears like a radar contact: ping, growing pole, name typed out', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const p = SQUAD.planes[0], e = ENEMIES.spawn('sam', p.pos.clone().addScaledVector(p.dir, 150).setY(0), 0);
    const label = () => e.label.visible ? [...LABEL_CACHE.entries()].find(([, m]) => m === e.label.material)[0].split('|')[0] : '';
    const out = {};
    draw(); out.t0 = { label: label(), n: LINES.n };
    __t.sim(0.8, { draw: true }); out.mid = label();
    __t.sim(1.0, { draw: true }); out.end = label();
    return { name: e.name, ...out };
  });
  expect(r.t0.label, 'no name before the pole is up').toBe('');
  expect(r.name.startsWith(r.mid) && r.mid.length > 0 && r.mid.length < r.name.length, `typing: "${r.mid}" of "${r.name}"`).toBe(true);
  expect(r.end).toBe(r.name);
});

test('camera in combat: the hero changes only with the shot, the focus never jerks', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.props({ shotlength: 30 });
    __t.forceFight(); __t.sim(10, { audio: true });
    let heroes = 0, hero = CAM.hero, spikes = 0, inSpike = false, maxA = 0;
    const v0 = new THREE.Vector3(), prev = CAM.focus.clone(), vel = new THREE.Vector3();
    for (let i = 0; i < 2400; i++) {   // 2 minutes
      __t.sim(0.05, { audio: true, check: false });
      vel.subVectors(CAM.focus, prev).divideScalar(0.05); prev.copy(CAM.focus);
      const a = vel.distanceTo(v0) / 0.05; v0.copy(vel);
      if (i > 2) maxA = Math.max(maxA, a);
      const spike = a > 150; if (spike && !inSpike) spikes++; inSpike = spike;
      if (CAM.hero !== hero) { heroes++; hero = CAM.hero; }
    }
    return { heroes, spikes, maxA: Math.round(maxA) };
  });
  expect(r.heroes, 'hero changes in 120 s with 30 s shots').toBeLessThanOrEqual(6);
  expect(r.spikes, `sharp focus kicks (max ${r.maxA} u/s²)`).toBeLessThanOrEqual(r.heroes + 1);
});

/* share of samples in which the point is inside the frame (2 % margin) */
const inFrame = (page) => page.evaluate(() => { window.__inFrame = p => { const s = __t.screen(p); return !!s && s.x > innerWidth * 0.02 && s.y > innerHeight * 0.02 && s.x < innerWidth * 0.98 && s.y < innerHeight * 0.98; }; });

for (const [name, w, h] of [['phone portrait', 390, 844], ['phone landscape', 844, 390], ['desktop', 1280, 720]])
  test(`${name} ${w}x${h}: the flight stays in frame in peace, the hero in combat`, async ({ wp, page }) => {
    await page.setViewportSize({ width: w, height: h });
    await wp.boot();
    await inFrame(page);
    const r = await wp.run(() => {
      __t.sim(10, { audio: false });
      let all = 0, n = 0;
      for (let k = 0; k < 120; k++) { __t.sim(1, { audio: false }); n++; if (SQUAD.planes.every(p => __inFrame(p.pos))) all++; }
      __t.forceFight(); __t.sim(15, { audio: true });
      let hero = 0, m = 0;
      for (let k = 0; k < 120; k++) { __t.sim(1, { audio: true }); m++; if (__inFrame(CAM.hero.pos)) hero++; }
      return { peace: all / n, combat: hero / m };
    });
    expect(r.peace, 'all four planes in frame (peace)').toBeGreaterThan(0.9);
    expect(r.combat, 'the hero in frame (combat)').toBeGreaterThan(0.9);
  });

test('phone portrait: names fit the screen, the ground under the flight is not fogged (zoomed out too)', async ({ wp, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await wp.boot();
  const r = await wp.run(() => {
    __t.props({ zoom: 40 }); __t.sim(20, { audio: false }); draw();
    const px = s => s.scale.x / (2 * Math.tan(camera.fov * DEG / 2)) * innerHeight;   // sprite width in CSS px
    const fog = TERRAIN.uniforms.uFog.value, dF = camera.position.distanceTo(CAM.focus);
    return { labelW: Math.max(...SQUAD.planes.map(p => px(p.label))) / innerWidth, dF, fogNear: fog.x };
  });
  expect(r.labelW, 'widest name / screen width').toBeLessThan(0.35);
  expect(r.dF, 'focus nearer than where the fog starts').toBeLessThan(r.fogNear);
});

test('shader warm-up: the scene compiles before the first frame, nothing compiles in a fight (boss included)', async ({ wp }) => {
  await wp.boot();
  const p0 = await wp.run(() => ({ programs: __t.programs(), ready: shadersReady, T }));
  expect(p0.ready).toBe(true);
  expect(p0.T, 'the frame loop (and T) starts only after the warm-up').toBe(0);
  expect(p0.programs, 'programs compiled by the warm-up (ground, LINES, GLOW, trails, labels)').toBeGreaterThanOrEqual(5);
  // the first frame compiles only the small post-processing passes (bloom, output) — under the splash
  const p1 = await wp.run(() => { draw(); return __t.pipelines(); });
  expect(p1, 'pipelines compiled on the first frame').toBeLessThanOrEqual(10);
  // a frame every simulated second (bloom on SwiftShader is slow): every kind of unit, missile and effect gets drawn
  const fight = (sec) => wp.run((sec) => { for (let i = 0; i < sec; i++) { __t.sim(1, { audio: true }); draw(); } }, sec);
  await wp.run(() => { __t.forceFight(); });
  await fight(30);
  await wp.run(() => { BOSSES.t = CFG.bossEvery * 60; });
  const r = await wp.until(() => !!BOSSES.boss && BOSSES.boss.t > 3, 120, { audio: true });
  expect(r.done, 'a boss came').toBe(true);
  await fight(20);
  expect(await wp.run(() => __t.pipelines()), 'render pipelines created after the first frame').toBe(p1);
});

test('bloom: a glow around the glyphs, off with the property; strength follows its slider', async ({ wp }) => {
  await wp.boot({ query: '?cam=fixed' });
  await wp.sim(10);
  const ring = () => wp.run(() => {
    const s = __t.screen(SQUAD.planes[0].pos), R = 40;
    const a = __t.sample(s.x - R, s.y - R, 2 * R, 2 * R);   // the glyph and its surroundings: the halo adds up
    return { lum: a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722, calls: __t.drawCalls(), pipe: PIPE.on };
  });
  const on = await ring();
  await wp.run(() => __t.props({ bloomstrength: 200 }));
  const strong = await ring();
  await wp.run(() => __t.props({ bloom: false }));
  const off = await ring();
  expect(on.pipe).toBe(true); expect(off.pipe).toBe(false);
  expect(off.lum, `no bloom: darker around the glyph ${JSON.stringify([on, strong, off])}`).toBeLessThan(on.lum);
  expect(strong.lum).toBeGreaterThan(on.lum);
  expect(off.calls, 'bloom passes cost a few draw calls').toBeLessThan(on.calls);
  await wp.run(() => __t.props({ bloom: true }));
  expect((await ring()).pipe).toBe(true);
});

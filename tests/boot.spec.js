// Start-up: the page boots cleanly in Wallpaper Engine mode and in a plain browser
const { test, expect } = require('./support/harness');

test('boots in Wallpaper Engine mode with WebGL2 and a four-ship flight', async ({ wp }) => {
  await wp.boot();
  const info = await wp.run(() => ({
    webgl2: renderer.capabilities.isWebGL2,
    planes: SQUAD.planes.length,
    labels: SQUAD.planes.map(p => [...LABEL_CACHE.entries()].find(([, m]) => m === p.label.material)[0].split('|')[0]),
    drawer: !!document.getElementById('cfg')
  }));
  expect(info.webgl2).toBe(true);
  expect(info.planes).toBe(4);
  expect(info.labels).toEqual(['STRIDER 1', 'STRIDER 2', 'STRIDER 3', 'STRIDER 4']);
  expect(info.drawer, 'no settings drawer inside Wallpaper Engine').toBe(false);
});

test('boots in a normal browser with the settings drawer and stays clean for a minute', async ({ wp }) => {
  await wp.boot({ we: false });
  const r = await wp.run(() => ({ demo: AUD.demo, buttons: document.querySelectorAll('button').length }));
  expect(r.demo).toBe(true);
  expect(r.buttons, 'the settings drawer adds its controls').toBeGreaterThan(3);
  const res = await wp.sim(60);
  expect(res.violations).toEqual([]);
});

test('properties apply: squadron name, colours, camera mode', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.props({ squadname: ' gar<l>m ', friendcolor: '0 0 1', cameramode: 'fixed', fixedazimuth: 90 });
    __t.sim(3);
    const name = [...LABEL_CACHE.entries()].find(([, m]) => m === SQUAD.planes[2].label.material)[0];
    return { name, color: PAL.friend.getHexString(), trail: SQUAD.planes[0].trail.color.getHexString(), mode: CFG.camMode, az: CAM.target().az };
  });
  expect(r.name.split('|')[0]).toBe('GARLM 3');
  expect(r.color).toBe('0000ff');
  expect(r.trail).toBe('0000ff');
  expect(r.mode).toBe('fixed');
  expect(r.az).toBe(90);
});

test('label textures of names / colours no longer shown are freed', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const n0 = LABEL_CACHE.size;
    for (const name of ['A', 'AB', 'ABC', 'ABCD', 'ABCDE', 'GHOST']) __t.props({ squadname: name });
    for (let i = 0; i < 20; i++) __t.props({ friendcolor: `${i / 20} 1 0.5` });
    return { n0, n1: LABEL_CACHE.size, shown: SQUAD.planes.every(p => LABEL_CACHE.get(p.label.material.userData.key) === p.label.material) };
  });
  expect(r.n1).toBeLessThanOrEqual(r.n0);
  expect(r.shown).toBe(true);
});

test('the loading splash covers the start, then dissolves', async ({ wp }) => {
  await wp.boot({ splash: true });
  const before = await wp.run(() => { const s = document.getElementById('splash'); return !!s && getComputedStyle(s).display !== 'none' && !s.classList.contains('off') && s.textContent; });
  expect(before).toContain('WIREFRAME SKIES');
  await wp.sim(3);   // SPLASH_T = 2.5
  expect(await wp.run(() => { const s = document.getElementById('splash'); return !s || s.classList.contains('off'); })).toBe(true);
});

test('a shorter shot length applies to the running shot; bad URL numbers are ignored', async ({ wp }) => {
  await wp.boot({ query: '?zoom=abc&ts=x' });
  const r = await wp.run(() => {
    __t.props({ shotlength: 60 }); CAM.nextShot(); const long = CAM.shotT;
    __t.props({ shotlength: 8 });
    __t.sim(1);
    return { long, now: CAM.shotT, zoom: CFG.zoom, cam: camera.position.toArray().every(Number.isFinite), ts: TIME_SCALE };
  });
  expect(r.long).toBeGreaterThan(40);
  expect(r.now).toBeLessThanOrEqual(8 * 1.2);
  expect(r.zoom).toBe(100);
  expect(r.cam).toBe(true);
  expect(r.ts).toBe(1);
});

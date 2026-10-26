// Not tests: render images.
//   PREVIEW=1      → preview.gif (animated 256x256, 4 s, the Workshop / project.json preview — Wallpaper Engine takes
//                    ≤ 256 px, < 1 MB, aim < 500 KB; seed GIF.seed) and screenshot.jpg (16:9, README; seed 1), each a
//                    deterministic combat moment
//   PREVIEW=gif    → test-results/gif-<seed>.gif (+ gif-<seed>-sheet.png, four frames to look at) for seeds 1..GIF.seeds:
//                    candidates; put the best one's seed into GIF.seed and render PREVIEW=1
//   PREVIEW=shots  → test-results/shots/*.png: a few scenarios for looking at changes (splash, peace with allies, combat,
//                    close-ups, a new contact appearing, mop-up, retreat, a boss)
// PREVIEW_T = seconds of combat before the GIF / the screenshot. See CLAUDE.md "Running & testing".
const { test, expect } = require('./support/harness');
const fs = require('fs');
const path = require('path');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const GIF = { size: 256, render: 512, frames: 40, fps: 10, colors: 96, seeds: 6, seed: 5 };   // seed: the one in preview.gif ($env:SEED overrides)

/* start over a coastline, so land and sea are both in the shot */
const toCoast = () => {
  for (let i = 0; i < 4000; i++) {
    const x = ROUTE.pos.x + (Math.random() - 0.5) * 30000, z = ROUTE.pos.z + (Math.random() - 0.5) * 30000;
    if (Math.abs(TERRAIN.land(x, z)) < 0.005 && TERRAIN.sample(x, z).mount > 0.6) { WORLD.origin.x += x - ROUTE.pos.x; WORLD.origin.z += z - ROUTE.pos.z; break; }
  }
  __t.sim(0.05); for (const p of SQUAD.planes) p.trail.reset(p.pos);
};

/* boot (seed), start over a coast, fight for `t` s, then record GIF.frames frames at GIF.fps into a 256² GIF (one
   palette for all frames: no flicker); returns its bytes. The contact sheet (four frames) goes to `sheet` when given. */
async function renderGif(wp, page, seed, t, sheet) {
  await page.setViewportSize({ width: GIF.render, height: GIF.render });
  await wp.boot({ seed });
  await wp.run(([toCoast, t]) => {
    (0, eval)(toCoast)();
    // drawing every step is slow in SwiftShader: only the last seconds (trails, labels typed out)
    __t.sim(30, { audio: false }); __t.forceFight(); __t.sim(t - 4, { audio: true }); __t.sim(4, { audio: true, draw: true });
  }, [`(${toCoast})`, t]);
  const frames = [];
  for (let i = 0; i < GIF.frames; i++) {
    const b64 = await wp.run(([size, fps, i, n]) => {
      __t.sim(1 / fps, { audio: true, draw: true, check: false }); draw();
      // downscale in halving steps (smooth, no aliasing) — in the same task as the render, so the WebGL buffer is still there
      const C = window.__gifC || (window.__gifC = {});
      let src = renderer.domElement, w = src.width;
      while (w > size) {
        w = Math.max(size, w >> 1);
        const c = C[w] || (C[w] = Object.assign(document.createElement('canvas'), { width: w, height: w }));
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, w); src = c;
      }
      const sh = C.sheet || (C.sheet = Object.assign(document.createElement('canvas'), { width: size * 2, height: size * 2 }));
      const k = [0, n / 3, 2 * n / 3, n - 1].map(Math.floor).indexOf(i);
      if (k >= 0) sh.getContext('2d').drawImage(src, (k % 2) * size, (k >> 1) * size);
      const d = src.getContext('2d').getImageData(0, 0, size, size).data;
      let s = ''; for (let j = 0; j < d.length; j += 0x8000) s += String.fromCharCode.apply(null, d.subarray(j, j + 0x8000));
      return btoa(s);
    }, [GIF.size, GIF.fps, i, GIF.frames]);
    frames.push(new Uint8Array(Buffer.from(b64, 'base64')));
  }
  if (sheet) fs.writeFileSync(sheet, Buffer.from(await wp.run(() => __gifC.sheet.toDataURL('image/png').split(',')[1]), 'base64'));
  // the palette from every other frame
  const all = new Uint8Array(frames[0].length * Math.ceil(frames.length / 2));
  frames.filter((f, i) => i % 2 === 0).forEach((f, i) => all.set(f, i * f.length));
  const palette = quantize(all, GIF.colors), gif = GIFEncoder();
  frames.forEach((f, i) => gif.writeFrame(applyPalette(f, palette), GIF.size, GIF.size,
    i ? { delay: 1000 / GIF.fps } : { palette, delay: 1000 / GIF.fps, repeat: 0 }));
  gif.finish();
  const bytes = gif.bytes();
  expect(bytes.length, 'Wallpaper Engine takes previews under 1 MB').toBeLessThan(1024 * 1024);
  return bytes;
}

const PREVIEW_T = Number(process.env.PREVIEW_T || 95);

test('render preview.gif (256², animated)', async ({ wp, page }) => {
  test.skip(process.env.PREVIEW !== '1', 'set PREVIEW=1 to render preview.gif and screenshot.jpg');
  const gif = await renderGif(wp, page, Number(process.env.SEED || GIF.seed), PREVIEW_T);
  fs.writeFileSync(path.join(__dirname, '..', 'preview.gif'), gif);
  console.log(`preview.gif: ${(gif.length / 1024).toFixed(0)} KB`);
});

test('render screenshot.jpg (16:9)', async ({ wp, page }) => {
  test.skip(process.env.PREVIEW !== '1', 'set PREVIEW=1 to render preview.gif and screenshot.jpg');
  test.setTimeout(20 * 60 * 1000);                             // a 1024² render every step: slow in SwiftShader
  await page.setViewportSize({ width: 1024, height: 1024 });   // the camera settles framed for a square, then goes wide
  await wp.boot();
  await wp.run(([toCoast, t]) => {
    (0, eval)(toCoast)();
    __t.sim(30, { audio: false }); __t.forceFight(); __t.sim(t, { audio: true, draw: true });
  }, [`(${toCoast})`, PREVIEW_T]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await wp.run(() => { resize(); CAM.place(); draw(); });
  await page.screenshot({ path: path.join(__dirname, '..', 'screenshot.jpg'), type: 'jpeg', quality: 88 });
});

for (let seed = 1; seed <= GIF.seeds; seed++) test(`render GIF candidate, seed ${seed}`, async ({ wp, page }) => {
  test.skip(process.env.PREVIEW !== 'gif', 'set PREVIEW=gif to render test-results/gif-<seed>.gif');
    const dir = path.join(__dirname, '..', 'test-results'); fs.mkdirSync(dir, { recursive: true });
  const gif = await renderGif(wp, page, seed, PREVIEW_T, path.join(dir, `gif-${seed}-sheet.png`));
  fs.writeFileSync(path.join(dir, `gif-${seed}.gif`), gif);
  console.log(`gif-${seed}.gif: ${(gif.length / 1024).toFixed(0)} KB`);
});

test('render scenario shots', async ({ wp, page }) => {
  test.skip(process.env.PREVIEW !== 'shots', 'set PREVIEW=shots to render test-results/shots/*.png');
  const dir = path.join(__dirname, '..', 'test-results', 'shots');
  const shot = async (name, fn, arg) => { await wp.run(fn, arg); await wp.run(() => draw()); await page.screenshot({ path: path.join(dir, name + '.png') }); };
  await wp.boot({ splash: true });
  await page.screenshot({ path: path.join(dir, '0-splash.png') });
  await wp.run(() => { document.getElementById('splash').style.display = 'none'; });
  await wp.run((toCoast) => (0, eval)(toCoast)(), `(${toCoast})`);
  await shot('1-peace', () => { __t.sim(45, { audio: false, draw: true }); });
  await shot('2-peace-allies', () => { __t.sim(0.05); const a = ALLIES.list.find(e => e.alive); if (a) { CAM.focus.copy(a.pos).lerp(SQUAD.planes[0].pos, 0.5); CAM.place(); } });
  // music on: first the combat spread (no enemies yet), then the break toward the first contacts
  await shot('3a-spread', () => { __t.forceFight(); __t.sim(3.5, { audio: true, draw: true }); });
  await shot('3b-contact', () => { __t.sim(20, { audio: true, draw: true, until: () => !SQUAD.alert }); __t.sim(1.5, { audio: true, draw: true }); });
  await shot('3-combat', () => { __t.sim(20, { audio: true, draw: true }); });
  await shot('4-combat-later', () => { __t.sim(17, { audio: true, draw: true }); });
  await shot('5-ground-closeup', () => {
    __t.sim(0.05); const e = ENEMIES.list.find(x => x.alive && x.ground) || ALLIES.list.find(x => x.alive && x.ground);
    if (e) { CAM.focus.copy(e.pos).setY(8); CAM.cur.dist = 70; CAM.cur.el = 25; CAM.place(); }
  });
  await shot('6-flight-closeup', () => { CAM.focus.copy(SQUAD.planes[0].pos); CAM.cur.dist = 45; CAM.cur.el = 18; CAM.place(); });
  // a fresh contact (radar ping, pole growing, name typing), a fighter appearing in the air
  await shot('7-appear', () => {
    const p = SQUAD.planes[0], g = p.pos.clone().addScaledVector(p.dir, 60).setY(0);
    ENEMIES.spawn('sam', g, 0); ENEMIES.spawn('fighter', g.clone().setY(p.pos.y + 10).add(new THREE.Vector3(20, 0, 0)), 0);
    __t.sim(0.7, { audio: true, draw: true }); CAM.focus.copy(g).setY(10); CAM.cur.dist = 90; CAM.cur.el = 30; CAM.place();
  });
  // mountains: the camera low over the highest ground nearby
  await shot('10-mountains', () => {
    let best = null, bh = -1;
    for (let i = 0; i < 3000; i++) { const x = ROUTE.pos.x + rand(-4000, 4000), z = ROUTE.pos.z + rand(-4000, 4000), h = TERRAIN.height(x, z); if (h > bh) { bh = h; best = new THREE.Vector3(x, h, z); } }
    CAM.focus.copy(best); CAM.cur.dist = 260; CAM.cur.el = 14; CAM.place(); draw();
  });
  // the music stops: mop-up, then the leftovers retreat (flicker, poles sinking)
  await shot('8-mopup', () => { __t.fightOff(); __t.sim(DISARM_DELAY + 3, { audio: false, draw: true }); });
  await shot('9-retreat', () => {
    __t.sim(MOPUP_T + 1, { audio: false, draw: true, until: () => SQUAD.mopT <= 0 }); __t.sim(1.6, { audio: false, draw: true });
    const e = ENEMIES.list.find(x => x.state === 'retreat' && x.ground) || ENEMIES.list.find(x => x.state === 'retreat');
    if (e) { CAM.focus.copy(e.pos).setY(10); CAM.cur.dist = 110; CAM.place(); }
  });
  // a boss (Arsenal Bird) in the fight
  await shot('13-boss', () => {
    __t.forceFight(); const b = BOSSES.spawnType('arsenal'); __t.sim(14, { audio: true, draw: true });
    CAM.focus.copy(b.pos).lerp(SQUAD.planes[0].pos, 0.4); CAM.cur.dist = 220; CAM.cur.el = 22; CAM.place();
  });
  // a phone in portrait: the camera backs off so the flight stays in frame
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('11-phone-peace', () => { __t.sim(20, { audio: false, draw: true }); });
  await shot('12-phone-combat', () => { __t.forceFight(); __t.sim(25, { audio: true, draw: true }); });
});

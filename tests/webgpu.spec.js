// The WebGPU backend (SwiftShader's WebGPU adapter, see playwright.config.js). Headless Chromium loses the device as soon
// as a WebGPU canvas is presented, so these tests never render to the canvas: frames go into a RenderTarget and are read
// back asynchronously (__t.sampleRT). Everything else runs on the WebGL 2 fallback (harness).
const { test, expect } = require('./support/harness');

test.use({ viewport: { width: 640, height: 360 } });

test('WebGPU: boots on the WebGPU backend, renders the map and a fight with bloom, compiles nothing new', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu' });
  const info = await wp.run(() => ({ webgpu: GPU.webgpu, device: !!renderer.backend.device, adapter: !!navigator.gpu, pipe: PIPE.on }));
  expect(info.adapter, 'navigator.gpu').toBe(true);
  expect(info.webgpu, 'WebGPURenderer chose the WebGPU backend').toBe(true);
  expect(info.device).toBe(true);
  expect(info.pipe, 'bloom on by default').toBe(true);
  await wp.sim(5);
  const r0 = await wp.run(async () => ({ all: await __t.sampleRT(0, 0, 640, 360), lower: await __t.sampleRT(0, 200, 640, 160) }));
  expect(r0.lower[2], `grid / sea dots: blue ${r0.lower}`).toBeGreaterThan(r0.lower[0] + 4);
  await wp.run(async () => { await __t.sampleRT(0, 0, 8, 8); });   // the RenderTarget's own pipelines (format / samples)
  const p0 = await wp.run(() => __t.pipelines());
  await wp.run(() => { __t.forceFight(); });
  let alive = 0;
  for (let t = 0; t < 40; t += 5) {
    await wp.sim(5, { audio: true });
    const r = await wp.run(async () => ({ c: await __t.sampleRT(0, 0, 640, 360), alive: ENEMIES.alive, dev: !!renderer.backend.device }));
    alive = Math.max(alive, r.alive); expect(r.dev).toBe(true); expect(r.c.every(Number.isFinite)).toBe(true);
  }
  expect(alive, 'a fight happened').toBeGreaterThan(0);
  expect(await wp.run(() => __t.pipelines()), 'pipelines compiled in the fight').toBe(p0);
});

test('WebGPU: the WGSL ground shader and TERRAIN agree on land / sea (u32 hash, floored mod)', async ({ wp }) => {
  await wp.boot({ gl: 'webgpu' });
  const r = await wp.run(async () => {
    const out = [];
    for (let i = 0; i < 4000; i++) {   // a steep coast: land and sea on screen
      const x = ROUTE.pos.x + (Math.random() - 0.5) * 30000, z = ROUTE.pos.z + (Math.random() - 0.5) * 30000;
      if (Math.abs(TERRAIN.land(x, z)) < 0.01 && Math.abs(TERRAIN.land(x + 40, z) - TERRAIN.land(x - 40, z)) > 0.04) { WORLD.origin.x += x - ROUTE.pos.x; WORLD.origin.z += z - ROUTE.pos.z; break; }
    }
    __t.sim(2); CAM.cur.el = 60; CAM.place();
    out.push(await __t.groundCheckRT(1200));
    WORLD.origin.x += 123456789; WORLD.origin.z -= 98765432;   // far away: wrapped origin, precision
    __t.sim(2); CAM.cur.el = 60; CAM.place();
    out.push(await __t.groundCheckRT(1200));
    return out;
  });
  for (const c of r) {
    expect(c.n, 'pixels compared: ' + JSON.stringify(r)).toBeGreaterThan(300);
    expect(c.bad, JSON.stringify(c.cases)).toBeLessThanOrEqual(Math.ceil(c.n * 0.005));
  }
});

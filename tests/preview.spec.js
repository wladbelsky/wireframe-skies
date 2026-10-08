// Not a test: renders preview.jpg (the Workshop / project.json preview) from a deterministic combat moment.
// Run with PREVIEW=1 (and optionally PREVIEW_T = seconds of combat, SEED) — see CLAUDE.md "Running & testing".
const { test } = require('./support/harness');
const path = require('path');

test('render preview.jpg', async ({ wp, page }) => {
  test.skip(!process.env.PREVIEW, 'set PREVIEW=1 to render preview.jpg');
  await wp.boot();
  await wp.run((t) => {
    // start over a coastline, so land and sea are both in the shot
    for (let i = 0; i < 4000; i++) {
      const x = ROUTE.pos.x + (Math.random() - 0.5) * 30000, z = ROUTE.pos.z + (Math.random() - 0.5) * 30000;
      if (Math.abs(TERRAIN.land(x, z)) < 0.005 && TERRAIN.sample(x, z).mount > 0.6) { WORLD.origin.x += x - ROUTE.pos.x; WORLD.origin.z += z - ROUTE.pos.z; break; }
    }
    __t.sim(0.05); for (const p of SQUAD.planes) p.trail.reset(p.pos);
    __t.sim(30, { audio: false }); __t.forceFight(); __t.sim(t, { audio: true, draw: true });
    draw();
  }, Number(process.env.PREVIEW_T || 26));
  await page.screenshot({ path: path.join(__dirname, '..', 'preview.jpg'), type: 'jpeg', quality: 88 });
});

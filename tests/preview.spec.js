// Not tests: render images.
//   PREVIEW=1      → preview.jpg (the Workshop / project.json preview) from a deterministic combat moment
//   PREVIEW=shots  → test-results/shots/*.png: a few scenarios for looking at changes (splash, peace with allies, combat,
//                    close-ups, a new contact appearing, mop-up, retreat)
// PREVIEW_T = seconds of combat before the preview shot. See CLAUDE.md "Running & testing".
const { test } = require('./support/harness');
const path = require('path');

/* start over a coastline, so land and sea are both in the shot */
const toCoast = () => {
  for (let i = 0; i < 4000; i++) {
    const x = ROUTE.pos.x + (Math.random() - 0.5) * 30000, z = ROUTE.pos.z + (Math.random() - 0.5) * 30000;
    if (Math.abs(TERRAIN.land(x, z)) < 0.005 && TERRAIN.sample(x, z).mount > 0.6) { WORLD.origin.x += x - ROUTE.pos.x; WORLD.origin.z += z - ROUTE.pos.z; break; }
  }
  __t.sim(0.05); for (const p of SQUAD.planes) p.trail.reset(p.pos);
};

test('render preview.jpg', async ({ wp, page }) => {
  test.skip(process.env.PREVIEW !== '1', 'set PREVIEW=1 to render preview.jpg');
  await wp.boot();
  await wp.run(([toCoast, t]) => {
    (0, eval)(toCoast)();
    __t.sim(30, { audio: false }); __t.forceFight(); __t.sim(t, { audio: true, draw: true });
    draw();
  }, [`(${toCoast})`, Number(process.env.PREVIEW_T || 26)]);
  await page.screenshot({ path: path.join(__dirname, '..', 'preview.jpg'), type: 'jpeg', quality: 88 });
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
  await shot('3-combat', () => { __t.forceFight(); __t.sim(25, { audio: true, draw: true }); });
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
  // the music stops: mop-up, then the leftovers retreat (flicker, poles sinking)
  await shot('8-mopup', () => { __t.fightOff(); __t.sim(DISARM_DELAY + 3, { audio: false, draw: true }); });
  await shot('9-retreat', () => {
    __t.sim(MOPUP_T + 1, { audio: false, draw: true, until: () => SQUAD.mopT <= 0 }); __t.sim(1.6, { audio: false, draw: true });
    const e = ENEMIES.list.find(x => x.state === 'retreat' && x.ground) || ENEMIES.list.find(x => x.state === 'retreat');
    if (e) { CAM.focus.copy(e.pos).setY(10); CAM.cur.dist = 110; CAM.place(); }
  });
});

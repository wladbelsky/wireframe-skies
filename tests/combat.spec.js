// Combat: music arms it, enemies spawn and get shot down on the beat, hostile fire always misses, the flight rejoins
const { test, expect } = require('./support/harness');

test('music arms combat after the delay, silence holds then stands down', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const s = {};
    __t.sim(2, { audio: true }); s.early = AUD.armed;                      // a short sound never arms it
    __t.sim(3, { audio: true }); s.armed = AUD.armed;
    __t.sim(2, { audio: false }); s.holding = AUD.holding && AUD.armed;
    __t.sim(6, { audio: false }); s.down = !AUD.armed;
    return s;
  });
  expect(r).toEqual({ early: false, armed: true, holding: true, down: true });
});

test('4 minutes of combat: kills, maneuvers, hostile missiles that miss, nobody lost', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight();
    const v = [], mans = new Set(), kinds = new Set();
    let hits = 0; const dmg = ENEMIES.damage.bind(ENEMIES); ENEMIES.damage = (e, d) => { hits++; kinds.add(e.type); return dmg(e, d); };
    for (let k = 0; k < 240; k++) {
      v.push(...__t.sim(1, { audio: true }).violations);
      for (const p of SQUAD.planes) if (p.man) mans.add(p.man.name);
    }
    return { v: v.slice(0, 10), s: __t.stats(), mans: [...mans], kinds: [...kinds], hits, minY: __t.minY };
  });
  expect(r.v).toEqual([]);
  expect(r.s.kills).toBeGreaterThan(15);
  expect(r.s.shots + r.s.allyShots, 'kills come from missiles (ours and allied)').toBeGreaterThan(r.s.kills * 0.8);
  expect(r.s.hostile, 'enemies fire back').toBeGreaterThan(1);
  expect(r.mans.length, `maneuvers seen: ${r.mans}`).toBeGreaterThan(3);
  expect(r.kinds.length, `target types hit: ${r.kinds}`).toBeGreaterThan(2);
  expect(r.minY).toBeGreaterThan(12);
});

test('after the fight the flight rejoins and the enemies are gone', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight(); __t.sim(60, { audio: true }); __t.fightOff();
    const v = __t.sim(8, { audio: false }).violations;
    const disarmed = !AUD.armed;
    const t0 = T; v.push(...__t.sim(120, { audio: false, until: () => SQUAD.planes.every(p => p.mode === 'form') }).violations); const rejoin = T - t0;
    const t1 = T; v.push(...__t.sim(180, { audio: false, until: () => ENEMIES.list.length === 0 }).violations); const clear = T - t1;
    return { v: v.slice(0, 10), disarmed, rejoin, clear, left: ENEMIES.list.length, missiles: MISSILES.live };
  });
  expect(r.v).toEqual([]);
  expect(r.disarmed).toBe(true);
  expect(r.rejoin, 'seconds to rejoin').toBeLessThan(60);
  expect(r.left, 'enemies left on the map').toBe(0);
  expect(r.clear).toBeLessThan(180);
});

test('enemy density 0: no enemies; enemies-fire off: no hostile missiles', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.props({ enemydensity: 0 }); __t.forceFight(); __t.sim(30, { audio: true });
    const none = ENEMIES.spawned;
    __t.props({ enemydensity: 150, enemiesfire: false }); __t.sim(90, { audio: true });
    return { none, spawned: ENEMIES.spawned, hostile: ENEMIES.missiles };
  });
  expect(r.none).toBe(0);
  expect(r.spawned).toBeGreaterThan(5);
  expect(r.hostile).toBe(0);
});

test('a missile never follows a recycled enemy slot; a full missile pool leaves no phantom "incoming"', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const out = {};
    const p = SQUAD.planes[0];
    const e = ENEMIES.spawn('fighter', p.pos.clone().add(new THREE.Vector3(0, 0, 300)), 0);
    let hits = 0;
    MISSILES.fire({ p: p.pos, d: p.dir, speed: 30, target: e, hit: true, onHit: () => { hits++; } });
    ENEMIES.vanish(e); __t.sim(FADE_T + 0.2);                       // freed …
    const again = ENEMIES.spawn('fighter', p.pos.clone().add(new THREE.Vector3(0, 0, -300)), 0);   // … and reused
    out.reused = again === e;
    __t.sim(12); out.hits = hits;
    // missile pool exhausted: shooting fails cleanly
    for (const m of MISSILES.pool) { m.on = true; m.age = 0; m.lock = 99; m.hit = false; m.target = null; }
    const t = ENEMIES.spawn('frigate', p.pos.clone().setY(0), 0) || again;
    p.target = t; t.chasers++; p.mode = 'engage'; t.incoming = 0;
    out.shot = SQUAD.shoot(p); out.incoming = t.incoming;
    return out;
  });
  expect(r.reused).toBe(true);
  expect(r.hits, 'the old missile ignored the new unit in the slot').toBe(0);
  expect(r.shot).toBe(false);
  expect(r.incoming).toBe(0);
});

test('an enemy air group is one type under one name; some fighter / attack groups are aces', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const out = { groups: 0, mixed: [], aces: 0, aceTypes: new Set(), aceNames: [] };
    for (let k = 0; k < 400; k++) {
      const n0 = ENEMIES.list.length; ENEMIES.airGroup(4);
      const g = ENEMIES.list.slice(n0); if (!g.length) continue;
      out.groups++;
      const types = new Set(g.map(e => e.type)), ace = g[0].ace;
      if (types.size !== 1 || g.some(e => e.ace !== ace)) out.mixed.push(g.map(e => e.type + ':' + e.name).join(','));
      if (ace) {
        out.aces++; out.aceTypes.add(g[0].type);
        const cs = g[0].name.split(' ')[0];
        if (!ACE_CALLSIGNS.includes(cs) || g.some((e, i) => e.name !== `${cs} ${i + 1}` || e.hp !== ENEMY_TYPES[e.type].hp + 1)) out.mixed.push('ace ' + g.map(e => e.name + '/' + e.hp).join(','));
      } else if (new Set(g.map(e => e.name)).size !== 1) out.mixed.push(g.map(e => e.name).join(','));
      for (const e of g) ENEMIES.free(e);
    }
    return { groups: out.groups, mixed: out.mixed.slice(0, 5), aces: out.aces, aceTypes: [...out.aceTypes] };
  });
  expect(r.mixed).toEqual([]);
  // fighter + attack groups are ~70 % of the weight, 15 % of them aces → ~10 % of all groups
  expect(r.aces, `aces in ${r.groups} groups`).toBeGreaterThan(r.groups * 0.05);
  expect(r.aces).toBeLessThan(r.groups * 0.2);
  for (const t of r.aceTypes) expect(['fighter', 'attacker']).toContain(t);
});

test('after the music: mop-up of the targets on screen, the rest retreat, then the flight rejoins', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const v = [];
    __t.forceFight(); v.push(...__t.sim(40, { audio: true }).violations);
    // make sure something is close and counts as on screen when the music stops
    const e = ENEMIES.spawn('heli', SQUAD.centroid(new THREE.Vector3()).setY(35), 0); e.mode = 'hover';
    const onScreen = CAM.onScreen; CAM.onScreen = (q, m) => q === e.pos || onScreen.call(CAM, q, m);
    __t.fightOff();
    v.push(...__t.sim(DISARM_DELAY + 0.3, { audio: false }).violations);
    const atStart = { mopT: SQUAD.mopT, mop: ENEMIES.list.filter(x => x.alive && x.mop).length, retreating: ENEMIES.list.filter(x => x.state === 'retreat').length,
      unmarkedAlive: ENEMIES.list.filter(x => x.alive && !x.mop).length };
    const k0 = ENEMIES.kills;
    v.push(...__t.sim(MOPUP_T + 1, { audio: false, until: () => SQUAD.mopT <= 0 }).violations);
    const mopKills = ENEMIES.kills - k0, rejoining = SQUAD.planes.every(q => q.mode === 'rejoin' || q.mode === 'form');
    v.push(...__t.sim(60, { audio: false, until: () => ENEMIES.list.length === 0 }).violations);
    return { v: v.slice(0, 10), atStart, mopKills, rejoining, left: ENEMIES.list.length };
  });
  expect(r.v).toEqual([]);
  expect(r.atStart.mopT).toBeGreaterThan(0);
  expect(r.atStart.mop, 'targets marked for the mop-up').toBeGreaterThan(0);
  expect(r.atStart.unmarkedAlive, 'everything not on screen retreats at once').toBe(0);
  expect(r.mopKills, 'the flight finished something off without music').toBeGreaterThan(0);
  expect(r.rejoining).toBe(true);
  expect(r.left).toBe(0);
});

test('music back during the mop-up: the fight just goes on', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight(); __t.sim(30, { audio: true });
    const e = ENEMIES.spawn('heli', SQUAD.centroid(new THREE.Vector3()).setY(35), 0); e.mode = 'hover';
    const onScreen = CAM.onScreen; CAM.onScreen = (q, m) => q === e.pos || onScreen.call(CAM, q, m);
    __t.fightOff(); __t.sim(DISARM_DELAY + 0.3, { audio: false });
    const mopT = SQUAD.mopT;
    const v = __t.sim(8, { audio: true }).violations;   // music again: arms after ARM_DELAY
    return { v: v.slice(0, 5), mopT, after: SQUAD.mopT, armed: AUD.armed, marked: ENEMIES.list.filter(x => x.mop).length, modes: SQUAD.planes.map(q => q.mode) };
  });
  expect(r.v).toEqual([]);
  expect(r.armed).toBe(true);
  expect(r.after).toBe(0);
  expect(r.marked).toBe(0);
  expect(r.modes.every(m => m !== 'form' && m !== 'rejoin')).toBe(true);
});

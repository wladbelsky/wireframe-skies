// Bosses: every CFG.bossEvery minutes of combat a boss (10 hits) with its escort; the flight brings each kind down
const { test, expect } = require('./support/harness');

/* in the page: a spot for a boss class near the route (ground: land, sea: open sea, air: ahead); flies on and retries */
const spotFor = (cls) => {
  for (let k = 0; k < 8; k++) {
    if (cls === 'air') return ROUTE.pos.clone().addScaledVector(ROUTE.fwd, 450);
    for (let i = 0; i < 400; i++) {
      const a = rand(0, TAU), d = rand(250, 650), x = ROUTE.pos.x + Math.sin(a) * d, z = ROUTE.pos.z + Math.cos(a) * d, l = TERRAIN.land(x, z);
      if (cls === 'ground' ? l > 0.08 : l < -0.12) return new THREE.Vector3(x, 0, z);
    }
    __t.sim(30, { audio: true });   // nothing fitting here: fly on (the route heads for a coast after a while)
  }
  return null;
};

test('a boss comes after the set minutes of combat (not before, not in peace), with its escort, then the timer restarts', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.props({ bossevery: 1 });
    const log = [], sp = ENEMIES.spawn.bind(ENEMIES);
    ENEMIES.spawn = (type, ...a) => { const s = sp(type, ...a); if (s) log.push({ type, T, boss: !!s.ty.boss }); return s; };
    const v = [];
    v.push(...__t.sim(90, { audio: false }).violations);   // peace: the boss clock stands still
    const peaceT = BOSSES.t;
    __t.forceFight();
    v.push(...__t.sim(55, { audio: true }).violations);
    const early = log.filter(e => e.boss).length;
    const w = __t.sim(40, { audio: true, until: () => !!BOSSES.boss }); v.push(...w.violations);
    const b = BOSSES.boss, at = b ? log.find(e => e.boss).T : 0;
    return { v: v.slice(0, 10), peaceT, early, boss: b && { type: b.type, hp: b.hp, cls: b.ty.cls }, escort: log.filter(e => !e.boss && e.T === at).length, t: BOSSES.t };
  });
  expect(r.v).toEqual([]);
  expect(r.peaceT).toBe(0);
  expect(r.early, 'no boss before a minute of combat').toBe(0);
  expect(r.boss, 'a boss after a minute of combat').toBeTruthy();
  expect(r.boss.hp).toBe(10);
  expect(r.escort, `escort of ${r.boss.type}`).toBeGreaterThan(0);
  expect(r.t).toBeLessThan(2);
});

test('no bosses when the interval is 0', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.props({ bossevery: 0 }); BOSSES.t = 1e6; __t.forceFight();
    let bosses = 0; const v = __t.sim(150, { audio: true, until: () => { if (BOSSES.boss) bosses++; return false; } }).violations;
    return { v: v.slice(0, 10), bosses };
  });
  expect(r.v).toEqual([]);
  expect(r.bosses).toBe(0);
});

test('ten hits bring a boss down, nine do not', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const b = BOSSES.spawnType('arsenal'), k0 = ENEMIES.kills;
    for (let i = 0; i < 9; i++) ENEMIES.damage(b, 1);
    const nine = { alive: b.alive, hp: b.hp };
    ENEMIES.damage(b, 1);
    return { nine, state: b.state, kills: ENEMIES.kills - k0 };
  });
  expect(r.nine).toEqual({ alive: true, hp: 1 });
  expect(r.state).toBe('struck');
  expect(r.kills).toBe(1);
});

test('the Arsenal Bird launches drones into the fight when there is room for them', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight(); const v = __t.sim(2, { audio: true }).violations;
    ENEMIES.waveT = 1e9;   // no regular waves (the drone runs below need room under the cap)
    const b = BOSSES.spawnType('arsenal');
    const w = __t.sim(60, { audio: true, until: () => ENEMIES.list.some(e => e.type === 'drone') || !b.alive }); v.push(...w.violations);
    return { v: v.slice(0, 10), drones: ENEMIES.list.filter(e => e.type === 'drone').length };
  });
  expect(r.v).toEqual([]);
  expect(r.drones, 'MQ-101s out of the bay').toBeGreaterThan(0);
});

/* each kind in turn (no regular waves): it shows up, fires its special (and misses), the flight brings it down */
for (const [name, kinds] of [['air', ['arsenal', 'cruiser', 'solg', 'superace']], ['ground', ['stonehenge', 'excalibur', 'landship']], ['sea', ['subcarrier', 'alicorn']]]) {
  test(`the flight brings the ${name} bosses down: ${kinds.join(', ')}`, async ({ wp }) => {
    await wp.boot();
    const r = await wp.run(([kinds, spotSrc]) => {
      const spotFor = (0, eval)(spotSrc);
      __t.props({ enemydensity: 0 }); __t.forceFight(); __t.sim(5, { audio: true });
      const specials = {}, sp = BOSSES.special.bind(BOSSES);
      BOSSES.special = (e, f, band) => { const ok = sp(e, f, band); if (ok) specials[e.type] = (specials[e.type] || 0) + 1; return ok; };
      const out = [], v = [];
      for (const k of kinds) {
        const at = spotFor(ENEMY_TYPES[k].cls); if (!at) { out.push({ k, skipped: true }); continue; }
        const b = BOSSES.spawnType(k, at); if (!b) { out.push({ k, skipped: true }); continue; }
        const s0 = SQUAD.shots, w = __t.sim(180, { audio: true, until: () => !b.alive }); v.push(...w.violations);
        // it goes down in frame: on screen for most of the time it burns (struck)
        let seen = 0, n = 0; __t.sim(STRUCK_T, { audio: true, until: () => { n++; if (CAM.onScreen(b.pos, 0.03)) seen++; return false; } });
        out.push({ k, down: b.downed, took: Math.round(w.steps * 0.05), shots: SQUAD.shots - s0, specials: specials[k] || 0, seen: +(seen / n).toFixed(2) });
        __t.sim(3, { audio: true });
      }
      return { v: v.slice(0, 10), out };
    }, [kinds, `(${spotFor})`]);
    expect(r.v).toEqual([]);
    const fought = r.out.filter(o => !o.skipped);
    expect(fought.length, JSON.stringify(r.out)).toBeGreaterThan(0);
    for (const o of fought) {
      expect(o.down, `${o.k} shot down: ${JSON.stringify(o)}`).toBe(true);
      expect(o.specials, `${o.k} special attacks`).toBeGreaterThan(0);
      expect(o.seen, `${o.k} goes down in frame`).toBeGreaterThan(0.8);
    }
  });
}

/* in a full fight (regular waves around it) the camera still frames the boss when it goes down */
test('a boss goes down in frame, in the middle of a full fight', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight(); const v = __t.sim(30, { audio: true }).violations, out = [];
    for (const k of ['arsenal', 'cruiser', 'superace', 'solg']) {
      const b = BOSSES.spawnType(k); if (!b) continue;
      const w = __t.sim(240, { audio: true, until: () => !b.alive }); v.push(...w.violations);
      let seen = 0, n = 0; __t.sim(STRUCK_T, { audio: true, until: () => { n++; if (CAM.onScreen(b.pos, 0.03)) seen++; return false; } });
      out.push({ k, down: b.downed, seen: +(seen / n).toFixed(2) });
      __t.sim(10, { audio: true });
    }
    return { v: v.slice(0, 10), out };
  });
  expect(r.v).toEqual([]);
  for (const o of r.out) { expect(o.down, o.k).toBe(true); expect(o.seen, `${o.k} goes down in frame`).toBeGreaterThan(0.8); }
});

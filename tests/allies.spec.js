// Allies: groups appear in peace (fleets at sea, columns on land, aircraft), join a fight with missiles that hit,
// are never struck, and fade away when switched off
const { test, expect } = require('./support/harness');

test('15 minutes of peace: allied fleets, columns and aircraft pass by', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    const kinds = new Set(), v = [];
    const sp = ALLIES.spawn.bind(ALLIES); ALLIES.spawn = (type, ...a) => { const s = sp(type, ...a); if (s) kinds.add(ALLY_TYPES[type].cls); return s; };
    for (let k = 0; k < 90; k++) v.push(...__t.sim(10, { audio: false }).violations);
    return { v: v.slice(0, 10), spawned: ALLIES.spawned, kinds: [...kinds], enemies: ENEMIES.spawned };
  });
  expect(r.v).toEqual([]);
  expect(r.spawned).toBeGreaterThan(8);
  expect(r.kinds.length, `classes seen: ${r.kinds}`).toBeGreaterThanOrEqual(2);
  expect(r.enemies).toBe(0);
});

test('allies fight alongside the flight and are never hit', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight();
    const v = [];
    const c = new THREE.Vector3();
    for (let k = 0; k < 30; k++) {
      // an allied pair joins the flight every 30 s (groups ahead of the route may never meet the enemy on some seeds)
      if (k % 3 === 0 && ALLIES.alive <= ALLY_CAP - 2) for (let i = 0; i < 2; i++) ALLIES.spawn('fighter', SQUAD.centroid(c).add(new THREE.Vector3(i * 12, 20, 0)), ROUTE.heading, `TEST ${i + 1}`);
      v.push(...__t.sim(10, { audio: true }).violations);
    }
    return { v: v.slice(0, 10), s: __t.stats(), allyKills: ALLIES.kills };
  });
  expect(r.v).toEqual([]);
  expect(r.s.allyShots, 'allied missiles').toBeGreaterThan(3);
  expect(r.allyKills, 'no ally is ever destroyed').toBe(0);
});

test('switching allies off fades the ones on the map and stops new groups', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    ALLIES.groupT = 0; __t.sim(5);
    const before = ALLIES.list.length;
    __t.props({ allies: false }); __t.sim(5);
    const after = ALLIES.list.length, spawned = ALLIES.spawned;
    __t.sim(300);
    return { before, after, more: ALLIES.spawned - spawned, left: ALLIES.list.length };
  });
  expect(r.before).toBeGreaterThan(0);
  expect(r.after).toBe(0);
  expect(r.more).toBe(0);
  expect(r.left).toBe(0);
});

test('allied fighters in a fight spread over the enemy and never merge into one glyph', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run(() => {
    __t.forceFight();
    const c = new THREE.Vector3(), v = [];
    let close = 0, pairs = 0;
    for (let k = 0; k < 150; k++) {
      // a four-ship joins the flight every 30 s (chasing the nearest enemy, they used to fly as one)
      if (k % 30 === 0 && ALLIES.alive <= ALLY_CAP - 4) for (let i = 0; i < 4; i++) ALLIES.spawn('fighter', SQUAD.centroid(c).add(new THREE.Vector3(i * 12, 20, 0)), ROUTE.heading, `TEST ${i + 1}`);
      v.push(...__t.sim(1, { audio: true }).violations);
      const f = ALLIES.list.filter(e => e.alive && e.plane);
      for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) { pairs++; if (f[i].pos.distanceTo(f[j].pos) < 6) close++; }
    }
    return { v: v.slice(0, 10), close, pairs };
  });
  expect(r.v).toEqual([]);
  expect(r.pairs).toBeGreaterThan(300);
  expect(r.close, `pairs of allied aircraft closer than 6 (of ${r.pairs})`).toBeLessThanOrEqual(2);
});

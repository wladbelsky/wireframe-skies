// Steering quality: no orbiting a target without shooting, no twitching (roll reversals) on turns
const { test, expect } = require('./support/harness');

/* wobbles: the bank swinging back and forth — two roll reversals (|roll rate| > 0.8 rad/s one way, then the other,
   within 0.6 s) in the same plane within 1.2 s, outside maneuvers. A single roll in and out of a turn doesn't count. */
const rollMeter = () => {
  const s = SQUAD.planes.map(p => ({ up: p.up.clone(), last: 0, lastT: -9, revT: -9 }));
  const c = new THREE.Vector3();
  let wobbles = 0;
  return {
    step(dt) {
      SQUAD.planes.forEach((p, i) => {
        const m = s[i]; c.crossVectors(m.up, p.up);
        const r = Math.atan2(c.dot(p.dir), m.up.dot(p.up)) / dt; m.up.copy(p.up);
        if (Math.abs(r) > 0.8) {
          if (m.last && Math.sign(r) !== Math.sign(m.last) && T - m.lastT < 0.6 && !p.maneuvering) { if (T - m.revT < 1.2) wobbles++; m.revT = T; }
          m.last = r; m.lastT = T;
        }
      });
    },
    get reversals() { return wobbles; }
  };
};

for (const [where, d0] of [['ahead', 150], ['right under the flight', 0]])
test(`a lone ship ${where} is attacked and sunk, not orbited`, async ({ wp }) => {
  await wp.boot();
  const r = await wp.run((d0) => {
    __t.props({ enemydensity: 0, enemiesfire: false });
    // a destroyer at sea near the flight (start the route over the sea next to it)
    let at = null;
    for (let i = 0; i < 4000 && !at; i++) {
      const x = ROUTE.pos.x + rand(-20000, 20000), z = ROUTE.pos.z + rand(-20000, 20000);
      if (TERRAIN.land(x, z) < -0.25) { WORLD.origin.x += Math.round(x - ROUTE.pos.x); WORLD.origin.z += Math.round(z - ROUTE.pos.z); at = 1; }
    }
    __t.sim(0.05); at = null;
    for (let d = d0; d < 4000 && !at; d += 50) for (let a = 0; a < 12 && !at; a++) {
      const h = ROUTE.heading + a * TAU / 12, x = ROUTE.pos.x + Math.sin(h) * d, z = ROUTE.pos.z + Math.cos(h) * d;
      if (TERRAIN.land(x, z) < -0.1) at = new THREE.Vector3(x, 0, z);
    }
    const e = ENEMIES.spawn('destroyer', at, 0);
    __t.forceFight();
    const t0 = T, v = __t.sim(90, { audio: true, until: () => !e.alive }).violations;
    return { took: T - t0, alive: e.alive, v: v.slice(0, 5), hp: e.hp, incoming: e.incoming, modes: SQUAD.planes.map(p => p.mode + (p.target === e ? '*' : '')) };
  }, d0);
  expect(r.v).toEqual([]);
  expect(r.alive, `the destroyer was sunk ${JSON.stringify(r)}`).toBe(false);
  expect(r.took).toBeLessThan(45);
});

test('no twitching: no bank wobbles in peace and in combat', async ({ wp }) => {
  await wp.boot();
  const r = await wp.run((src) => {
    const meter = (0, eval)(src)();
    for (let i = 0; i < 2400; i++) { __t.sim(0.05, { audio: false, check: false }); meter.step(0.05); }   // 2 min peace
    const peace = meter.reversals;
    __t.forceFight();
    for (let i = 0; i < 2400; i++) { __t.sim(0.05, { audio: true, check: false }); meter.step(0.05); }   // 2 min combat
    return { peace, combat: meter.reversals - peace };
  }, `(${rollMeter})`);
  expect(r.peace, 'wobbles in 2 min of peace').toBeLessThanOrEqual(1);
  // the few left are marginal (~0.9 rad/s) right after a decision (new target, extend); the old steering had hundreds
  expect(r.combat, 'wobbles in 2 min of combat (4 planes)').toBeLessThanOrEqual(6);
});

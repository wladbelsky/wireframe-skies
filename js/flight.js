'use strict';
/* ===== Flight model =====
   Kinematic, but it looks right: the flight path (dir) turns toward a commanded direction at a limited rate, the
   aircraft rolls so its lift vector points into the turn (plus a 1 g "gravity" share, so level turns are banked and
   straight flight is wings level), turning is slower while it is still rolling in. Maneuvers are scripted body rates
   (roll p, pitch q) that take over for a few seconds: loops, rolls, Immelmann, split-S, break turns.
   Model axes: nose +Z, up +Y (Plane.sync builds the quaternion from dir / up). */
const FLOOR = 16, CEIL = 260;   // hard altitude limits for every aircraft (units; ground is y = 0)
const _ax = new V3(), _pp = new V3(), _gu = new V3(), _du = new V3(), _m4 = new THREE.Matrix4(), _xa = new V3(), _dd = new V3();

class Plane {
  constructor(o) {
    this.pos = new V3(); this.dir = new V3(0, 0, 1); this.up = new V3(0, 1, 0);
    this.speed = o.speed || 24; this.tgtSpeed = this.speed; this.accel = o.accel || 9;
    this.turnRate = o.turnRate || 0.5; this.rollRate = o.rollRate || 2.4; this.rateMul = 1;
    this.man = null;   // { segs: [{ d, p, q }], i, t, name }
    this.obj = new THREE.Group();
  }
  get maneuvering() { return !!this.man; }
  get pitch() { return Math.asin(clamp(this.dir.y, -1, 1)); }
  get heading() { return Math.atan2(this.dir.x, this.dir.z); }   // 0 = +z, π/2 = +x
  place(p, heading, pitch) {
    this.pos.copy(p); this.dir.set(Math.sin(heading) * Math.cos(pitch || 0), Math.sin(pitch || 0), Math.cos(heading) * Math.cos(pitch || 0));
    this.up.set(0, 1, 0); this.orthoUp(); this.sync();
  }
  orthoUp() {
    this.up.addScaledVector(this.dir, -this.up.dot(this.dir));
    if (this.up.lengthSq() < 1e-8) this.up.set(0, 1, 0).addScaledVector(this.dir, -this.dir.y);
    if (this.up.lengthSq() < 1e-8) this.up.set(1, 0, 0);
    this.up.normalize();
  }
  /* fly toward the unit direction D (ignored while a maneuver runs) */
  steer(D, dt) {
    if (this.man) { this.runManeuver(dt); return; }
    // keep out of the ground / the stratosphere whatever the caller wants
    _dd.copy(D);
    const yp = this.pos.y + Math.min(0, this.dir.y) * this.speed * 2.5;   // where a dive takes it in 2.5 s
    const low = yp < FLOOR + 14;   // pull-up: full rate, never mind the roll
    if (low) { _dd.y = Math.max(_dd.y, 0.2 + (FLOOR + 14 - yp) * 0.03); this.rateMul = Math.max(this.rateMul, 2); }
    if (this.pos.y > CEIL - 20) _dd.y = Math.min(_dd.y, -(this.pos.y - CEIL + 20) * 0.03);
    _dd.normalize();
    const dot = clamp(this.dir.dot(_dd), -1, 1), ang = Math.acos(dot);
    // lift direction: into the turn + a 1 g share straight up
    _pp.copy(_dd).addScaledVector(this.dir, -dot);
    if (_pp.lengthSq() < 1e-8) _pp.copy(this.up);   // dead astern: pull through
    _pp.normalize();
    _gu.copy(UP).addScaledVector(this.dir, -this.dir.y);
    _du.copy(_pp).multiplyScalar(Math.min(1, ang * 2.5) * 2.4 * this.rateMul).add(_gu);
    if (_du.lengthSq() > 0.01) {
      _du.normalize();
      _ax.crossVectors(this.up, _du);
      const phi = Math.atan2(_ax.dot(this.dir), this.up.dot(_du)), lim = this.rollRate * this.rateMul * dt;
      this.up.applyAxisAngle(this.dir, clamp(phi, -lim, lim));
    }
    // turn (slower while not yet rolled into it)
    if (ang > 1e-5) {
      const eff = this.turnRate * this.rateMul * (low ? 1 : 0.35 + 0.65 * Math.max(0, this.up.dot(_pp)));
      _ax.crossVectors(this.dir, _dd);
      if (_ax.lengthSq() < 1e-10) _ax.crossVectors(this.dir, this.up);
      _ax.normalize();
      const a = Math.min(ang, eff * dt);
      this.dir.applyAxisAngle(_ax, a); this.up.applyAxisAngle(_ax, a);
    }
    this.dir.normalize(); this.orthoUp();
  }
  /* ---- maneuvers ---- */
  maneuver(name, segs) { this.man = { name, segs, i: 0, t: 0 }; }
  runManeuver(dt) {
    const m = this.man, s = m.segs[m.i];
    if (s.p) this.up.applyAxisAngle(this.dir, s.p * dt);
    if (s.q) { _ax.crossVectors(this.dir, this.up).normalize(); this.dir.applyAxisAngle(_ax, s.q * dt); this.up.applyAxisAngle(_ax, s.q * dt); }
    this.dir.normalize(); this.orthoUp();
    m.t += dt; if (m.t >= s.d) { m.t = 0; m.i++; if (m.i >= m.segs.length) this.man = null; }
    // never into the ground: a maneuver heading down near the floor is cut short (steering pulls up next step)
    if (this.man && this.pos.y + Math.min(0, this.dir.y) * this.speed * 2.5 < FLOOR + 12) this.man = null;
    if (this.man && this.pos.y > CEIL && this.dir.y > 0.05) this.man = null;
  }
  move(dt) {
    this.speed += clamp(this.tgtSpeed - this.speed, -this.accel * dt, this.accel * dt);
    this.pos.addScaledVector(this.dir, this.speed * dt);
    if (this.pos.y < FLOOR * 0.6) this.pos.y = FLOOR * 0.6;   // last resort (never seen in tests)
  }
  sync() {
    _xa.crossVectors(this.up, this.dir);
    _m4.makeBasis(_xa, this.up, this.dir);
    this.obj.quaternion.setFromRotationMatrix(_m4);
    this.obj.position.copy(this.pos);
  }
}

/* ---- maneuver library: name → { min / max altitude needed, segments for a plane at speed v } ----
   R = v / q is the loop radius; s = ±1 picks the side. */
const MANEUVERS = {
  loop:      { w: 1.0, need: (p, R) => p.pos.y > FLOOR + 20 && p.pos.y + 2 * R < CEIL - 10 && Math.abs(p.dir.y) < 0.35,
               segs: (v, s) => { const q = 0.9; return [{ d: TAU / q, q }]; } },
  barrel:    { w: 1.2, need: (p, R) => p.pos.y > FLOOR + R + 15 && p.pos.y + R < CEIL - 10,
               segs: (v, s) => [{ d: 4, p: s * TAU / 4, q: 0.55 }] },
  aileron:   { w: 1.0, need: (p) => p.pos.y > FLOOR + 10, segs: (v, s) => [{ d: 1.7, p: s * TAU / 1.7 }] },
  immelmann: { w: 1.0, need: (p, R) => p.pos.y + 2 * R < CEIL - 10 && Math.abs(p.dir.y) < 0.35,
               segs: (v, s) => [{ d: Math.PI / 0.95, q: 0.95 }, { d: 1.1, p: s * Math.PI / 1.1 }] },
  splitS:    { w: 1.0, need: (p, R) => p.pos.y - 2 * R > FLOOR + 25 && Math.abs(p.dir.y) < 0.35,
               segs: (v, s) => [{ d: 1.1, p: s * Math.PI / 1.1 }, { d: Math.PI / 0.95, q: 0.95 }] },
  breakTurn: { w: 1.4, need: (p) => p.pos.y > FLOOR + 8, segs: (v, s) => [{ d: 0.55, p: s * 2.6 }, { d: 2.8, q: 1.05 }] },
  wingover:  { w: 0.8, need: (p, R) => p.pos.y + R < CEIL - 10, segs: (v, s) => [{ d: 0.6, p: s * 1.6 }, { d: 3.4, q: 0.85 }, { d: 0.6, p: -s * 1.6 }] }
};
/* start a random maneuver the plane has room for (names: allow-list); returns its name or null */
function tryManeuver(plane, names) {
  const R = plane.speed / 0.95, ok = names.filter(n => MANEUVERS[n].need(plane, R));
  if (!ok.length) return null;
  const n = wpick(ok.map(k => ({ k, w: MANEUVERS[k].w }))).k;
  plane.maneuver(n, MANEUVERS[n].segs(plane.speed, Math.random() < 0.5 ? 1 : -1));
  return n;
}

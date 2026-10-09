'use strict';
/* ===== Flight model =====
   Kinematic, but it looks right: the flight path (dir) turns toward a commanded direction at a limited rate, the
   aircraft rolls so its lift vector points into the turn (plus a 1 g "gravity" share, so level turns are banked and
   straight flight is wings level), turning is slower while it is still rolling in. Maneuvers are scripted body rates
   (roll p, pitch q) that take over for a few seconds: loops, rolls, Immelmann, split-S, break turns.
   No twitching: the commanded direction is smoothed (CMD_T — target swaps and thresholds in the callers become
   glides), so is the rate multiplier; the roll has inertia (roll rate rollV, limited by ROLL_ACC) and a roll that has
   to go almost all the way round keeps its direction. Maneuver segments ease their rates in and out (the same total
   angle). Ground / ceiling avoidance acts on the smoothed command at once.
   Glyph axes: nose +Z (dir), up +Y (up), x = up × dir. */
const CMD_T = 0.35;   // s: time constant of the commanded-direction smoothing
const ROLL_K = 3, ROLL_ACC = 5;   // roll: rate per radian of bank error (1/s), max roll acceleration (rad/s²)
const SEG_RAMP = 0.2;   // maneuver segments: share of the time spent easing the rates in / out
const TURN_TAU = 1.2;   // s: a direction error is turned out over about this long — the bank follows the turn rate that needs
const FLOOR = 16, CEIL = 320;   // altitude limits for every aircraft: FLOOR above the ground under it / ahead, CEIL absolute
const _ax = new V3(), _pp = new V3(), _gu = new V3(), _du = new V3(), _dd = new V3(), _dw = new V3();

class Plane {
  constructor(o) {
    this.pos = new V3(); this.dir = new V3(0, 0, 1); this.up = new V3(0, 1, 0);
    this.speed = o.speed || 24; this.tgtSpeed = this.speed; this.accel = o.accel || 9;
    this.turnRate = o.turnRate || 0.5; this.rollRate = o.rollRate || 2.4; this.rateMul = 1;
    this.cmd = new V3(0, 0, 1); this.rm = 1; this.rollV = 0; this.low = false; this.side = 1;   // smoothed command, rate multiplier, roll rate, pulling up, way round
    this.man = null;   // { segs: [{ d, p, q }], i, t, name }
  }
  get maneuvering() { return !!this.man; }
  get agl() { return this.pos.y - TERRAIN.height(this.pos.x, this.pos.z); }   // height above the ground
  /* the ground height to keep clear of: under the aircraft and where it will be in t seconds */
  groundAhead(t) { const k = this.speed * t; return Math.max(TERRAIN.height(this.pos.x, this.pos.z), TERRAIN.height(this.pos.x + this.dir.x * k, this.pos.z + this.dir.z * k)); }
  place(p, heading, pitch) {
    this.pos.copy(p); this.dir.set(Math.sin(heading) * Math.cos(pitch || 0), Math.sin(pitch || 0), Math.cos(heading) * Math.cos(pitch || 0));
    this.up.set(0, 1, 0); this.orthoUp(); this.cmd.copy(this.dir); this.rm = 1; this.rollV = 0; this.low = false; this.side = 1;   // a pooled aircraft starts afresh
  }
  orthoUp() {
    this.up.addScaledVector(this.dir, -this.up.dot(this.dir));
    if (this.up.lengthSq() < 1e-8) this.up.set(0, 1, 0).addScaledVector(this.dir, -this.dir.y);
    if (this.up.lengthSq() < 1e-8) this.up.set(1, 0, 0);
    this.up.normalize();
  }
  /* fly toward the unit direction D (ignored while a maneuver runs) */
  steer(D, dt) {
    if (this.man) { this.runManeuver(dt); this.cmd.copy(this.dir); this.rollV = 0; return; }   // segments end at rest (eased)
    // way behind: turn round sideways, nearly level (the shortest way on the sphere would go over the top or straight
    // down — a dive into the ground). The side sticks unless the wish clearly lies on the other one
    if (this.dir.dot(D) < -0.2 && this.dir.x * this.dir.x + this.dir.z * this.dir.z > 0.1) {
      _dw.set(this.dir.z, 0, -this.dir.x).normalize();
      const k = _dw.dot(D); if (Math.abs(k) > 0.15) this.side = Math.sign(k);
      _dw.multiplyScalar(this.side).setY(clamp(D.y, -0.15, 0.3)).normalize(); D = _dw;
    }
    // smooth what the caller wants (a new target, a threshold crossed: a glide, not a jerk)
    slerpToward(this.cmd, D, 1 - Math.exp(-dt / CMD_T));
    this.rm += (this.rateMul - this.rm) * Math.min(1, dt * 3);
    _dd.copy(this.cmd);
    // keep out of the ground / the stratosphere whatever the caller wants. Soft: never ask for a dive steeper than
    // the height to spare over the next 2.5 s allows (so attack dives don't keep tripping the pull-up below: a dive
    // held at this limit ends FLOOR + 20 up, above where the pull-up lets go: FLOOR + 18)
    const ga = this.groundAhead(2.5), spare = this.pos.y - ga - (FLOOR + 20);
    _dd.y = Math.max(_dd.y, -Math.max(0, spare) / (this.speed * 2.5)); _dd.normalize();
    // hard: where the current dive takes it in 2.5 s
    const yp = this.pos.y + Math.min(0, this.dir.y) * this.speed * 2.5 - ga;
    const low = this.low = yp < FLOOR + (this.low ? 18 : 14);   // pull-up (with hysteresis, letting go below the soft limit): full rate, never mind the roll
    if (low) { _dd.y = Math.max(_dd.y, 0.2 + (FLOOR + 14 - yp) * 0.03); this.rm = Math.max(this.rm, 2); }
    if (this.pos.y > CEIL - 20) _dd.y = Math.min(_dd.y, -(this.pos.y - CEIL + 20) * 0.03);
    _dd.normalize();
    const dot = clamp(this.dir.dot(_dd), -1, 1), ang = Math.acos(dot);
    // lift direction: into the turn (as much as the needed turn rate asks for, up to 2.4 g × rate) + a 1 g share up
    _pp.copy(_dd).addScaledVector(this.dir, -dot);
    if (_pp.lengthSq() < 1e-8) _pp.copy(this.up);   // dead astern: pull through
    _pp.normalize();
    _gu.copy(UP).addScaledVector(this.dir, -this.dir.y);
    _du.copy(_pp).multiplyScalar(Math.min(1, ang / (TURN_TAU * this.turnRate * this.rm)) * 2.4 * this.rm).add(_gu);
    if (_du.lengthSq() > 0.01) {
      _du.normalize();
      _ax.crossVectors(this.up, _du);
      let phi = Math.atan2(_ax.dot(this.dir), this.up.dot(_du));
      // nearly upside down from where it should be: keep rolling the way it already rolls (no back-and-forth)
      if (Math.abs(phi) > 2.6 && Math.abs(this.rollV) > 0.2 && Math.sign(phi) !== Math.sign(this.rollV)) phi -= Math.sign(phi) * TAU;
      // roll with inertia: the rate eases toward what the bank error asks for, never past the bank wanted
      const maxR = this.rollRate * this.rm, want = clamp(phi * ROLL_K, -maxR, maxR), acc = ROLL_ACC * (low ? 2 : 1) * dt;
      this.rollV += clamp(want - this.rollV, -acc, acc);
      const r = Math.abs(this.rollV * dt) > Math.abs(phi) && Math.sign(this.rollV) === Math.sign(phi) ? phi : this.rollV * dt;
      this.up.applyAxisAngle(this.dir, r);
    }
    // turn (slower while not yet rolled into it)
    if (ang > 1e-5) {
      const eff = this.turnRate * this.rm * (low ? 1 : 0.35 + 0.65 * Math.max(0, this.up.dot(_pp)));
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
    // ease in / out over SEG_RAMP of the segment (trapezoid), scaled so the total angle stays the same
    const u = m.t / s.d, env = Math.min(1, u / SEG_RAMP, (1 - u) / SEG_RAMP) / (1 - SEG_RAMP), k = Math.max(0, env) * dt;
    if (s.p) this.up.applyAxisAngle(this.dir, s.p * k);
    if (s.q) { _ax.crossVectors(this.dir, this.up).normalize(); this.dir.applyAxisAngle(_ax, s.q * k); this.up.applyAxisAngle(_ax, s.q * k); }
    this.dir.normalize(); this.orthoUp();
    m.t += dt; if (m.t >= s.d) { m.t = 0; m.i++; if (m.i >= m.segs.length) this.man = null; }
    // never into the ground: a maneuver heading down near the floor is cut short (steering pulls up next step)
    if (this.man && this.pos.y + Math.min(0, this.dir.y) * this.speed * 2.5 - this.groundAhead(2.5) < FLOOR + 12) this.man = null;
    if (this.man && this.pos.y > CEIL && this.dir.y > 0.05) this.man = null;
  }
  move(dt) {
    this.speed += clamp(this.tgtSpeed - this.speed, -this.accel * dt, this.accel * dt);
    this.pos.addScaledVector(this.dir, this.speed * dt);
    const g = TERRAIN.height(this.pos.x, this.pos.z) + FLOOR * 0.6; if (this.pos.y < g) this.pos.y = g;   // last resort (never seen in tests)
  }
}

/* rotate unit vector v toward unit vector t by the fraction k of the angle between them (in place) */
const _sx = new V3(), XAXIS = new V3(1, 0, 0);
function slerpToward(v, t, k) {
  const a = Math.acos(clamp(v.dot(t), -1, 1)); if (a < 1e-6) { v.copy(t); return v; }
  _sx.crossVectors(v, t); if (_sx.lengthSq() < 1e-10) _sx.crossVectors(v, Math.abs(v.y) < 0.9 ? UP : XAXIS);   // opposite: any perpendicular axis
  return v.applyAxisAngle(_sx.normalize(), a * k).normalize();
}

/* ---- maneuver library: name → { min / max altitude needed, segments for a plane at speed v } ----
   R = v / q is the loop radius; s = ±1 picks the side. */
const MANEUVERS = {
  loop:      { w: 1.0, need: (p, R) => p.agl > FLOOR + 20 && p.pos.y + 2 * R < CEIL - 10 && Math.abs(p.dir.y) < 0.35,
               segs: (v, s) => { const q = 0.9; return [{ d: TAU / q, q }]; } },
  barrel:    { w: 1.2, need: (p, R) => p.agl > FLOOR + R + 15 && p.pos.y + R < CEIL - 10,
               segs: (v, s) => [{ d: 4, p: s * TAU / 4, q: 0.55 }] },
  aileron:   { w: 1.0, need: (p) => p.agl > FLOOR + 10, segs: (v, s) => [{ d: 1.7, p: s * TAU / 1.7 }] },
  immelmann: { w: 1.0, need: (p, R) => p.pos.y + 2 * R < CEIL - 10 && Math.abs(p.dir.y) < 0.35,
               segs: (v, s) => [{ d: Math.PI / 0.95, q: 0.95 }, { d: 1.1, p: s * Math.PI / 1.1 }] },
  splitS:    { w: 1.0, need: (p, R) => p.pos.y - 2 * R - p.groundAhead(3) > FLOOR + 25 && Math.abs(p.dir.y) < 0.35,
               segs: (v, s) => [{ d: 1.1, p: s * Math.PI / 1.1 }, { d: Math.PI / 0.95, q: 0.95 }] },
  breakTurn: { w: 1.4, need: (p) => p.agl > FLOOR + 8, segs: (v, s) => [{ d: 0.55, p: s * 2.6 }, { d: 2.8, q: 1.05 }] },
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

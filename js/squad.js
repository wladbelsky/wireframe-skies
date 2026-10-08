'use strict';
/* ===== The flight: route, formation, combat behaviour =====
   ROUTE is a virtual lead point moving across the map (gentle turns, altitude changes). In peace every plane flies
   its formation slot relative to ROUTE. In combat (AUD.armed) ROUTE slows down (the battle area drifts forward) and
   every plane fights on its own: pick a target, attack run, shoot (on the beat), reposition with a maneuver, evade
   hostile missiles with a break turn and flares. When combat ends ROUTE jumps to the flight and they rejoin.
   Plane modes: form (slot flying) | engage (attack run on p.target) | reposition (after a shot / a break, maneuvers) |
   rejoin (back to the slot after a fight). Evading a missile is a break turn + flares, then reposition. */
const CRUISE = 24;
const SAME_SEA_T = 60, SAME_LAND_T = 150, SCOUT_R = 3000;   // s over open sea / land before the route heads for a coast; look-out range
const FORMATIONS = {   // slots: [right, up, back] relative to ROUTE (lead first)
  finger:  [[0, 0, 0], [-9, 0, -7], [9, 0, -7], [18, 0, -14]],
  diamond: [[0, 0, 0], [-9, -1, -7], [9, -1, -7], [0, -2, -14]],
  echelon: [[0, 0, 0], [9, 0, -7], [18, 0, -14], [27, 0, -21]],
  abreast: [[0, 0, 0], [-12, 0, -1], [12, 0, -1], [24, 0, -2]],
  trail:   [[0, 0, 0], [0, -1.5, -12], [0, -3, -24], [0, -4.5, -36]]
};
const ROUTE = {
  pos: new V3(0, 70, 0), heading: 0, tgtHeading: 0, alt: 70, tgtAlt: 70, speed: CRUISE, turnT: 25, altT: 12,
  fwd: new V3(0, 0, 1), right: new V3(-1, 0, 0), combat: false, overLand: false, sameT: 0, scouted: false,
  get cruise() { return CRUISE * CFG.speed / 100; },
  update(dt) {
    this.turnT -= dt; this.altT -= dt;
    // variety: open sea (or land) that goes on too long → turn toward the nearest coast
    const over = TERRAIN.land(this.pos.x, this.pos.z) > 0;
    if (over !== this.overLand) { this.overLand = over; this.sameT = 0; this.scouted = false; } else this.sameT += dt;
    if (!this.scouted && this.sameT > (over ? SAME_LAND_T : SAME_SEA_T)) { this.scouted = true; this.turnT = Math.min(this.turnT, 0); }
    if (this.turnT <= 0) {
      this.turnT = rand(18, 50);
      const coast = this.scouted && this.sameT > 1 ? this.scout(!over) : null;
      this.tgtHeading = coast != null ? coast : this.heading + (Math.random() < 0.5 ? -1 : 1) * rand(15, 75) * DEG;
    }
    if (this.altT <= 0) { this.altT = rand(10, 30); this.tgtAlt = rand(38, 140); }
    this.heading = approachAngle(this.heading, this.tgtHeading, 0.06 * dt);
    this.alt += clamp(this.tgtAlt - this.alt, -3.5 * dt, 3.5 * dt);
    const sp = this.combat ? this.cruise * 0.45 : this.cruise; this.speed += clamp(sp - this.speed, -6 * dt, 4 * dt);
    this.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading)); this.right.set(-Math.cos(this.heading), 0, Math.sin(this.heading));
    this.pos.addScaledVector(this.fwd, this.speed * dt); this.pos.y = this.alt;
  },
  /* the heading (within ±90°) that reaches land (wantLand) or sea soonest, or null if none within SCOUT_R */
  scout(wantLand) {
    let best = null, bd = Infinity;
    for (let a = -90; a <= 90; a += 15) {
      const h = this.heading + a * DEG, sx = Math.sin(h), sz = Math.cos(h);
      for (let d = 150; d <= SCOUT_R && d < bd; d += 150)
        if ((TERRAIN.land(this.pos.x + sx * d, this.pos.z + sz * d) > 0) === wantLand) { if (d + Math.abs(a) < bd) { bd = d + Math.abs(a); best = h; } break; }
    }
    return best;
  },
  /* world position of a formation offset */
  slot(o, out) { return out.copy(this.pos).addScaledVector(this.right, o[0]).addScaledVector(this.fwd, o[2]).setY(this.pos.y + o[1]); },
  shift(dx, dz) { this.pos.x -= dx; this.pos.z -= dz; }
};

const _sl = new V3(), _tg = new V3(), _D = new V3(), _c = new V3(), _lp = new V3(), _fp = new V3(), _gv = new V3();
const SQUAD = {
  planes: [], form: 'finger', formT: 60, stuntT: 40, fireRR: 0, wasArmed: false, shots: 0,
  build(scene) {
    for (let i = 0; i < 4; i++) {
      const p = new Plane({ speed: CRUISE, turnRate: 0.5, rollRate: 2.6 });
      p.idx = i; p.alive = true; p.mode = 'form'; p.target = null; p.modeT = 0; p.cd = rand(0, 1); p.ready = 0; p.evadeAt = -1; p.flareT = 0;
      p.vel = new V3();
      p.label = makeLabel(); scene.add(p.label);
      p.trail = new Trail(scene, PAL.friend);
      ROUTE.slot(FORMATIONS.finger[i], _sl); p.place(_sl, ROUTE.heading, 0); p.trail.reset(p.pos);
      this.planes.push(p);
    }
    this.relabel();
  },
  relabel() { this.planes.forEach((p, i) => setLabel(p.label, `${CFG.squad} ${i + 1}`, cssOf(PAL.friend))); },
  recolor() { for (const p of this.planes) p.trail.recolor(PAL.friend); this.relabel(); },
  centroid(out) { out.set(0, 0, 0); for (const p of this.planes) out.add(p.pos); return out.multiplyScalar(1 / this.planes.length); },

  update(dt) {
    const armed = AUD.armed;
    if (armed && !this.wasArmed) this.engageAll();
    if (!armed && this.wasArmed) this.rejoin();
    this.wasArmed = armed; ROUTE.combat = armed;
    ROUTE.update(dt);
    if (!armed) this.peace(dt);
    for (const p of this.planes) {
      if (armed && p.mode !== 'form') this.fight(p, dt); else this.keepSlot(p, dt);
      p.steer(_D, dt); p.move(dt);
      p.vel.copy(p.dir).multiplyScalar(p.speed);
      p.trail.update(dt, p.pos, true);
      this.flares(p, dt);
    }
  },
  /* ---- peace: formation, formation changes, the odd roll ---- */
  peace(dt) {
    this.formT -= dt;
    if (this.formT <= 0) { this.formT = rand(45, 110); this.form = pick(Object.keys(FORMATIONS).filter(k => k !== this.form)); }
    if (CFG.maneuvers > 0) {
      this.stuntT -= dt * CFG.maneuvers / 5;
      if (this.stuntT <= 0) {
        this.stuntT = rand(30, 70);
        const free = this.planes.filter(p => !p.maneuvering && p.mode === 'form');
        if (free.length === 4 && Math.random() < 0.3) { const s = Math.random() < 0.5 ? 1 : -1; for (const p of free) p.maneuver('aileron', MANEUVERS.aileron.segs(p.speed, s)); }
        else if (free.length) tryManeuver(pick(free), Math.random() < 0.8 ? ['aileron', 'barrel'] : ['loop', 'barrel']);
      }
    }
  },
  keepSlot(p, dt) {
    ROUTE.slot(FORMATIONS[this.form][p.idx], _sl);
    const err = _tg.subVectors(_sl, p.pos), along = err.dot(ROUTE.fwd), far = err.length();
    _D.copy(ROUTE.fwd).multiplyScalar(Math.max(ROUTE.speed, 10) * 1.3).add(err);
    if (far > 120) _D.copy(err);   // way off: head straight there
    _D.normalize(); _D.y = clamp(_D.y, -0.5, 0.5); _D.normalize();
    p.tgtSpeed = clamp(ROUTE.speed + along * 0.6, ROUTE.speed - 8, ROUTE.speed + 16);
    p.rateMul = far > 40 ? 1.6 : 1;
    if (p.mode !== 'form' && far < 25) p.mode = 'form';
  },
  /* ---- combat ---- */
  engageAll() {
    this.planes.forEach((p, i) => {
      p.mode = 'reposition'; p.modeT = rand(1.5, 3); p.target = null; p.rateMul = 1.8;
      if (!p.maneuvering && MANEUVERS.breakTurn.need(p)) p.maneuver('breakTurn', MANEUVERS.breakTurn.segs(p.speed, i % 3 === 0 ? -1 : 1));
    });
  },
  rejoin() {
    // the route restarts from where the flight is, heading where it heads on average
    this.centroid(_c); _tg.set(0, 0, 0); for (const p of this.planes) _tg.add(p.dir);
    ROUTE.pos.copy(_c); ROUTE.heading = ROUTE.tgtHeading = Math.atan2(_tg.x, _tg.z);
    ROUTE.alt = ROUTE.tgtAlt = clamp(_c.y, 40, 140); ROUTE.speed = ROUTE.cruise * 0.7; ROUTE.turnT = rand(15, 30);
    ROUTE.pos.addScaledVector(_tg.setY(0).normalize(), -10);
    for (const p of this.planes) { this.release(p); p.mode = 'rejoin'; }
    this.formT = rand(45, 110);
  },
  pickTarget(p) {
    let best = null, bs = Infinity;
    for (const e of ENEMIES.list) {
      if (!e.alive || e.hp - e.incoming <= 0) continue;
      const d = p.pos.distanceTo(e.pos), toC = e.pos.distanceTo(ROUTE.pos);
      _tg.subVectors(e.pos, p.pos).normalize();
      const s = d + (1 - p.dir.dot(_tg)) * 120 + e.chasers * 160 + Math.max(0, toC - 500) * 2 + Math.random() * 80;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  },
  fight(p, dt) {
    p.cd -= dt; p.modeT -= dt; p.rateMul = 1.9; p.tgtSpeed = ROUTE.cruise * 1.3;
    if (p.evadeAt > 0 && T >= p.evadeAt) {   // hostile missile inbound: break and pop flares
      p.evadeAt = -1; p.flareT = 1.3;
      if (MANEUVERS.breakTurn.need(p)) p.maneuver('breakTurn', MANEUVERS.breakTurn.segs(p.speed, Math.random() < 0.5 ? 1 : -1));
      p.mode = 'reposition'; p.modeT = rand(2.5, 4); this.release(p);
    }
    if (p.mode === 'rejoin') p.mode = 'reposition';
    if (p.target && !p.target.alive) this.release(p);
    if (p.mode === 'engage' && !p.target) { p.mode = 'reposition'; p.modeT = rand(0.5, 1.5); }
    if (p.mode === 'reposition' && p.modeT <= 0 && !p.maneuvering) {
      const t = AUD.fighting ? this.pickTarget(p) : null;
      if (t) { p.target = t; t.chasers++; p.mode = 'engage'; p.modeT = 25; p.ready = 0; }
      else p.modeT = rand(1, 2);
    }
    if (p.mode === 'engage' && p.modeT <= 0) { this.release(p); p.mode = 'reposition'; p.modeT = 1; }   // taking too long
    // steering
    const t = p.target;
    if (p.mode === 'engage' && t) {
      const d = p.pos.distanceTo(t.pos);
      _lp.copy(t.pos); if (t.vel) _lp.addScaledVector(t.vel, Math.min(2, d / 70));
      if (t.ground) {
        // ground run: approach at altitude, then a shallow dive onto it
        if (d > 230) _lp.y = clamp(p.pos.y, 55, 110); else _lp.y = t.pos.y + 3;
      }
      _D.subVectors(_lp, p.pos).normalize();
      if (t.ground && p.pos.y < 34 && _D.y < 0) _D.y = 0.15;
      _D.y = clamp(_D.y, -0.6, 0.6); _D.normalize();
      const aim = p.dir.dot(_tg.subVectors(t.pos, p.pos).normalize());
      const inRange = d > 35 && d < (t.ground ? 190 : 210) && aim > 0.86;
      p.ready = inRange && p.cd <= 0 ? p.ready + dt : 0;
      if (p.ready > 1.6 && AUD.fighting) this.shoot(p);   // music too quiet for beats: shoot anyway
      if (d < 26 || (t.ground && d < 45 && p.pos.y < 30)) { this.release(p); this.afterShot(p); }   // overshoot: break off
    } else if (!p.maneuvering) {
      // repositioning / nothing to do: extend, stay near the battle area, keep a sane altitude
      _c.subVectors(ROUTE.pos, p.pos); const far = _c.length();
      _D.copy(p.dir); if (far > 260) _D.lerp(_c.normalize(), 0.6);
      _D.y = clamp(_D.y + (70 - p.pos.y) * 0.006, -0.4, 0.5); _D.normalize();
    }
  },
  release(p) {
    if (p.target) p.target.chasers = Math.max(0, p.target.chasers - 1);
    p.target = null; if (p.mode === 'engage') { p.mode = 'reposition'; p.modeT = rand(0.5, 1.5); }
  },
  afterShot(p) {
    p.mode = 'reposition'; p.modeT = rand(2, 4.5);
    if (Math.random() < 0.35 + CFG.maneuvers * 0.06) tryManeuver(p, ['loop', 'immelmann', 'splitS', 'barrel', 'breakTurn', 'wingover', 'aileron']);
  },
  shoot(p) {
    const t = p.target; if (!t || !t.alive) return false;
    _fp.copy(p.pos).addScaledVector(p.dir, 3).addScaledVector(p.up, -0.6);
    const m = MISSILES.fire({ p: _fp, d: p.dir, speed: p.speed + 6, target: t, hit: true, onHit: () => { t.incoming = Math.max(0, t.incoming - 1); ENEMIES.damage(t, 1); } });
    if (!m) { p.cd = 0.5; return false; }   // every missile slot busy: try again in a moment
    p.cd = rand(1.4, 2.4); p.ready = 0; t.incoming++; this.shots++;
    GLOW.spawn(_fp, { c: PAL.missile, s: 3, life: 0.25 });
    this.release(p); this.afterShot(p);
    return true;
  },
  guns(p) {
    const t = p.target; if (!t || !t.alive || t.ground) return;
    const d = p.pos.distanceTo(t.pos); if (d > 80) return;
    _tg.subVectors(t.pos, p.pos).normalize(); if (p.dir.dot(_tg) < 0.95) return;
    for (let i = 0; i < 4; i++) {
      _fp.copy(p.pos).addScaledVector(p.dir, 2.5 + i * 2.5);
      TRACERS.spawn(_fp, _gv.set(rand(-0.03, 0.03), rand(-0.03, 0.03), rand(-0.03, 0.03)).add(_tg).normalize().multiplyScalar(110), Math.min(0.8, d / 110));
    }
    if (Math.random() < 0.35) ENEMIES.damage(t, 1);
  },
  /* beats: one missile per low beat (the next plane that is ready), guns on mid beats */
  onBeat(band, strength) {
    if (band === 'low') {
      for (let k = 0; k < 4; k++) {
        const p = this.planes[(this.fireRR + k) % 4];
        if (p.mode === 'engage' && p.ready > 0.15) { this.fireRR = (p.idx + 1) % 4; this.shoot(p); break; }
      }
    } else if (band === 'mid') for (const p of this.planes) if (p.mode === 'engage') this.guns(p);
  },
  /* a hostile missile was launched at p: it reacts after a moment */
  threat(p) { if (p.evadeAt < 0) p.evadeAt = T + rand(0.4, 1.0); },
  flares(p, dt) {
    if (p.flareT <= 0) return;
    const before = p.flareT; p.flareT -= dt;
    if (Math.floor(before / 0.12) !== Math.floor(p.flareT / 0.12))
      for (const s of [-1, 1]) GLOW.spawn(p.pos, { v: _tg.copy(p.dir).multiplyScalar(-6).addScaledVector(p.up, -4).addScaledVector(_c.crossVectors(p.dir, p.up), s * 7), c: PAL.flare, s: 1.3, life: 1.5, drag: 1.2, grav: 6 });
  },
  /* per frame: glyphs, altitude lines and labels */
  draw() {
    for (const p of this.planes) {
      drawGlyph(GLYPHS.arrow, p.pos, p.dir, p.up, 2.2, PAL.friend, 1, 2.6);
      if (CFG.dropLines) LINES.drop(p.pos, PAL.friend, 0.95, 3.2);
      p.label.visible = CFG.labels; p.label.position.copy(p.pos).y += 2.5;
    }
  },
  shift(dx, dz) { for (const p of this.planes) { p.pos.x -= dx; p.pos.z -= dz; p.trail.shift(dx, dz); } }
};

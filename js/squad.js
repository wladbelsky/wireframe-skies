'use strict';
/* ===== The flight: route, formation, combat behaviour =====
   ROUTE is a virtual lead point moving across the map (gentle turns, altitude changes). In peace every plane flies
   its formation slot relative to ROUTE. In combat (SQUAD.engaged) ROUTE slows down (the battle area drifts forward)
   and the flight fights as two elements (1 + 2, 3 + 4): pick a target, attack run, shoot (on the beat), reposition
   with a maneuver, evade hostile missiles with a break turn and flares. The wingman backs its lead up (the lead's
   target if it takes more than one shot, else one next to it; between attacks it covers the lead's six); everyone
   finishes what the element started, damaged and long-ignored enemies first, and clears a mate's tail. Everything
   happens around the battle area (anchor: where the enemies near the flight are), which ROUTE turns toward and waits
   for, so nothing is left behind half-dead.
   When the music starts (AUD.armed) there is nothing to fight yet: the flight moves into a combat spread
   (COMBAT_SPREAD, SQUAD.alert, a little faster) and only breaks when the first contacts show on radar (contact():
   toward them — a break turn if they are behind, else a hard turn in).
   When the music stops (AUD.armed → false, after the hold) comes the mop-up: for up to MOPUP_T s the flight finishes
   off the enemies that were on screen (e.mop; shots paced by a timer, no beats); every other enemy retreats at once,
   the rest when the mop-up ends. Then ROUTE jumps to the flight and they rejoin.
   Plane modes: form (slot flying) | engage (attack run on p.target) | reposition (after a shot / a break, maneuvers) |
   rejoin (back to the slot after a fight). Evading a missile is a break turn + flares, then reposition. */
const CRUISE = 24;
const SAME_SEA_T = 60, SAME_LAND_T = 150, SCOUT_R = 3000;   // s over open sea / land before the route heads for a coast; look-out range
const ROUTE_CLEAR = 35;   // the route's minimum height above the terrain under / ahead of it
const MOPUP_T = 14, MOPUP_R = 450;   // s of mop-up after the music; how far from the flight an on-screen enemy still counts
const NOAIM_T = 3, ATTACK_AGL = 75;   // s near a target without a firing solution before extending; height to come back in at
const ANCHOR_R = 700, AREA_R = 250;   // enemies this near the flight make up the battle area; further from its centre than this pulls back
const FORMATIONS = {   // slots: [right, up, back] relative to ROUTE (lead first)
  finger:  [[0, 0, 0], [-9, 0, -7], [9, 0, -7], [18, 0, -14]],
  diamond: [[0, 0, 0], [-9, -1, -7], [9, -1, -7], [0, -2, -14]],
  echelon: [[0, 0, 0], [9, 0, -7], [18, 0, -14], [27, 0, -21]],
  abreast: [[0, 0, 0], [-12, 0, -1], [12, 0, -1], [24, 0, -2]],
  trail:   [[0, 0, 0], [0, -1.5, -12], [0, -3, -24], [0, -4.5, -36]]
};
const COMBAT_SPREAD = [[0, 0, 0], [-12, -1, -9], [36, 2, -5], [48, 1, -14]];   // music on, no contact yet: two pairs side by side
const ROUTE = {
  pos: new V3(0, 70, 0), heading: 0, tgtHeading: 0, alt: 70, tgtAlt: 70, speed: CRUISE, turnT: 25, altT: 12,
  fwd: new V3(0, 0, 1), right: new V3(-1, 0, 0), combat: false, overLand: false, sameT: 0, scouted: false, clearT: 0, ground: 0,
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
    // altitude: the chosen one, but always ROUTE_CLEAR above the terrain under and ahead of the route (climb faster then)
    if ((this.clearT -= dt) <= 0) {   // terrain under / ahead of the route, refreshed twice a second
      this.clearT = 0.5; this.ground = 0;
      for (let d = 0; d <= 600; d += 100) this.ground = Math.max(this.ground, TERRAIN.height(this.pos.x + this.fwd.x * d, this.pos.z + this.fwd.z * d));
    }
    const g = this.ground;
    const want = Math.max(this.tgtAlt, g + ROUTE_CLEAR);
    this.alt += clamp(want - this.alt, -3.5 * dt, (this.alt < g + ROUTE_CLEAR ? 10 : 3.5) * dt);
    // in a fight: head for the battle area and wait for it (enemies off to the side / behind are not left behind)
    let slow = false;
    if (this.combat && SQUAD.foes) { _ra.subVectors(SQUAD.anchor, this.pos).setY(0); if (_ra.length() > 120) this.tgtHeading = Math.atan2(_ra.x, _ra.z); slow = _ra.dot(this.fwd) < 80; }
    const sp = this.combat ? this.cruise * (slow ? 0.2 : 0.45) : this.cruise * (SQUAD.alert ? 1.15 : 1); this.speed += clamp(sp - this.speed, -6 * dt, 4 * dt);
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

const _sl = new V3(), _tg = new V3(), _D = new V3(), _c = new V3(), _lp = new V3(), _fp = new V3(), _gv = new V3(), _ra = new V3();
const SQUAD = {
  planes: [], form: 'finger', formT: 60, stuntT: 40, fireRR: 0, wasArmed: false, shots: 0, mopT: 0, anchor: new V3(), foes: 0, alert: false,
  get engaged() { return AUD.armed || this.mopT > 0; },     // the flight fights (vs formation flying)
  get firing() { return AUD.fighting || this.mopT > 0; },   // new targets and shots
  build(scene) {
    for (let i = 0; i < 4; i++) {
      const p = new Plane({ speed: CRUISE, turnRate: 0.5, rollRate: 2.6 });
      p.idx = i; p.alive = true; p.mode = 'form'; p.target = null; p.modeT = 0; p.cd = rand(0, 1); p.ready = 0; p.evadeAt = -1; p.flareT = 0;
      p.vel = new V3(); p.last = null; p.lastGen = 0;
      p.label = makeLabel(); scene.add(p.label);
      p.trail = new Trail(scene, PAL.friend);
      ROUTE.slot(FORMATIONS.finger[i], _sl); p.place(_sl, ROUTE.heading, 0); p.trail.reset(p.pos);
      this.planes.push(p);
    }
    this.anchor.copy(ROUTE.pos);
    this.relabel();
  },
  relabel() { this.planes.forEach((p, i) => setLabel(p.label, `${CFG.squad} ${i + 1}`, cssOf(PAL.friend))); },
  recolor() { for (const p of this.planes) p.trail.recolor(PAL.friend); this.relabel(); },
  centroid(out) { out.set(0, 0, 0); for (const p of this.planes) out.add(p.pos); return out.multiplyScalar(1 / this.planes.length); },

  update(dt) {
    const armed = AUD.armed;
    if (armed && !this.wasArmed) { if (this.mopT > 0) this.resume(); else this.alertAll(); }
    if (!armed && this.wasArmed) this.startMopUp();
    this.wasArmed = armed;
    if (this.mopT > 0 && ((this.mopT -= dt) <= 0 || !ENEMIES.list.some(e => e.alive && e.mop))) this.endMopUp();
    if (this.alert && ENEMIES.list.some(e => e.alive && e.t >= APPEAR_T * 0.6)) this.contact();   // the first ping is up
    this.updateAnchor(dt);
    const engaged = this.engaged, fighting = engaged && !this.alert; ROUTE.combat = fighting;
    ROUTE.update(dt);
    if (!engaged) this.peace(dt);
    for (const p of this.planes) {
      if (fighting && p.mode !== 'form') this.fight(p, dt); else this.keepSlot(p, dt);
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
    const far = this.follow(p, ROUTE.slot((this.alert ? COMBAT_SPREAD : FORMATIONS[this.form])[p.idx], _sl), ROUTE.fwd, ROUTE.speed);
    p.rateMul = far > 40 ? 1.6 : 1;
    if (p.mode !== 'form' && far < 25) p.mode = 'form';
  },
  /* fly to a point moving along fwd at speed (a slot): steering into _D, matching speed; returns the distance to it */
  follow(p, at, fwd, speed) {
    const err = _tg.subVectors(at, p.pos), along = err.dot(fwd), far = err.length();
    _D.copy(fwd).multiplyScalar(Math.max(speed, 10) * 1.3).add(err);
    if (far > 120) _D.copy(err);   // way off: head straight there
    _D.normalize(); _D.y = clamp(_D.y, -0.5, 0.5); _D.normalize();
    p.tgtSpeed = clamp(speed + along * 0.6, speed - 8, speed + 16);
    return far;
  },
  /* ---- combat ---- */
  /* the battle area: the live enemies near the flight (nearer ones count more; in the mop-up only its targets),
     else just ahead of the route. Smoothed, so a kill doesn't jerk it */
  updateAnchor(dt) {
    this.centroid(_c); _tg.set(0, 0, 0);
    let w = 0, n = 0;
    for (const e of ENEMIES.list) {
      if (!e.alive || (this.mopT > 0 && !e.mop)) continue;
      const d = e.pos.distanceTo(_c); if (d > ANCHOR_R) continue;
      const k = 1 / (1 + d / 150); _tg.addScaledVector(e.pos, k); w += k; n++;
    }
    this.foes = n;
    if (n) _tg.multiplyScalar(1 / w); else _tg.copy(ROUTE.pos).addScaledVector(ROUTE.fwd, 120);
    this.anchor.lerp(_tg, 1 - Math.exp(-dt / 1.5));
  },
  mate(p) { return this.planes[p.idx ^ 1]; },
  isWing(p) { return p.idx % 2 === 1; },
  onTail(p, e) { for (const q of this.planes) if (q !== p && q.pos.distanceTo(e.pos) < 120) return true; return false; },   // e is close to one of p's mates
  started(p, e) { return p.last === e && p.lastGen === e.gen; },   // p fired at this very enemy (not a reused slot)
  /* the music started: into the combat spread, nothing to fight yet */
  alertAll() { this.alert = true; for (const p of this.planes) { this.release(p); if (p.mode !== 'form') p.mode = 'rejoin'; } },
  /* the first contacts are on radar: break toward them (a break turn when they are behind, else a hard turn in) */
  contact() {
    this.alert = false;
    this.centroid(_c); _tg.set(0, 0, 0); let w = 0;
    for (const e of ENEMIES.list) if (e.alive) { const k = 1 / (1 + e.pos.distanceTo(_c) / 150); _tg.addScaledVector(e.pos, k); w += k; }
    _tg.multiplyScalar(1 / w);
    for (const p of this.planes) { p.mode = 'reposition'; p.modeT = this.isWing(p) ? rand(0.6, 1.1) : rand(0.3, 0.8); }
    for (const lead of this.planes) {   // per pair: both break, the same way, or neither does
      if (this.isWing(lead)) continue;
      const wing = this.mate(lead);
      _lp.subVectors(_tg, lead.pos).normalize();
      if (lead.dir.dot(_lp) > -0.2 || lead.maneuvering || wing.maneuvering || !MANEUVERS.breakTurn.need(lead) || !MANEUVERS.breakTurn.need(wing)) continue;
      _gv.crossVectors(lead.up, lead.dir);   // the glyph's x: a positive roll puts the lift on the other side
      const s = _gv.dot(_lp) > 0 ? -1 : 1;
      for (const p of [lead, wing]) p.maneuver('breakTurn', MANEUVERS.breakTurn.segs(p.speed, s));
    }
  },
  /* the music stopped: finish off what is on screen, the other enemies retreat now */
  startMopUp() {
    this.centroid(_c);
    for (const e of ENEMIES.list) {
      if (!e.alive) continue;
      e.mop = !this.alert && e.pos.distanceTo(_c) < MOPUP_R && CAM.onScreen(e.pos, 0.05);   // no contact yet: nothing to finish
      if (!e.mop) ENEMIES.retreat(e);
    }
    this.mopT = MOPUP_T;
    if (!ENEMIES.list.some(e => e.alive && e.mop)) this.endMopUp();
  },
  endMopUp() {
    this.mopT = 0;
    for (const e of ENEMIES.list) if (e.alive) ENEMIES.retreat(e);
    this.rejoin();
  },
  /* the music came back during the mop-up: the fight simply goes on */
  resume() { this.mopT = 0; for (const e of ENEMIES.list) e.mop = false; },
  rejoin() {
    // the route restarts from where the flight is, heading where it heads on average
    this.centroid(_c); _tg.set(0, 0, 0); for (const p of this.planes) _tg.add(p.dir);
    ROUTE.pos.copy(_c); ROUTE.heading = ROUTE.tgtHeading = Math.atan2(_tg.x, _tg.z);
    ROUTE.alt = ROUTE.tgtAlt = clamp(_c.y, 40, 140); ROUTE.speed = ROUTE.cruise * 0.7; ROUTE.turnT = rand(15, 30);
    ROUTE.pos.addScaledVector(_tg.setY(0).normalize(), -10);
    for (const p of this.planes) { this.release(p); p.mode = 'rejoin'; p.evadeAt = -1; }   // no break left over for the next fight
    this.formT = rand(45, 110); this.alert = false;
  },
  /* lower score = better: near, ahead of the nose, in the battle area, not taken yet — plus teamwork */
  pickTarget(p) {
    let best = null, bs = Infinity;
    const mop = this.mopT > 0, mate = this.mate(p), lead = this.isWing(p) ? mate : null;
    const lt = lead && lead.mode === 'engage' ? lead.target : null;
    for (const e of ENEMIES.list) {
      if (!e.alive || e.hp - e.incoming <= 0 || (mop && !e.mop)) continue;
      const d = p.pos.distanceTo(e.pos);
      _tg.subVectors(e.pos, p.pos).normalize();
      let s = d + (1 - p.dir.dot(_tg)) * 120 + Math.max(0, e.pos.distanceTo(this.anchor) - AREA_R) * 2 + Math.random() * 60;
      if (lt) s += e === lt ? (e.hp - e.incoming > 1 || e.plane ? -150 : 300) : e.chasers * 160 + e.pos.distanceTo(lt.pos) * 0.8;   // wingman: back the lead up
      else s += e.chasers * 160 + (lead ? e.pos.distanceTo(lead.pos) * 0.5 : 0);   // spread over the targets; a wingman stays near its lead
      if (this.started(p, e) || this.started(mate, e)) s -= 200;   // finish what the element started
      if (e.hurt) s -= 180;
      if (mop) s += (e.hp - e.incoming - 1) * 400;   // no music, little time: what goes down with one more hit first
      s -= Math.min(e.t, 60) * 5;   // been there a long time: its turn
      if (e.plane && e.mode === 'dogfight' && this.onTail(p, e)) s -= 120;   // on a mate's tail: clear it
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  },
  fight(p, dt) {
    p.cd -= dt; p.modeT -= dt; p.rateMul = 1.9; p.tgtSpeed = ROUTE.cruise * 1.3;
    if (p.evadeAt > 0 && T >= p.evadeAt) {   // hostile missile inbound: break and pop flares
      p.evadeAt = -1; p.flareT = 1.3;
      if (MANEUVERS.breakTurn.need(p)) p.maneuver('breakTurn', MANEUVERS.breakTurn.segs(p.speed, Math.random() < 0.5 ? 1 : -1));
      if (p.mode === 'engage' && p.target) { p.ready = 0; p.noAim = -NOAIM_T; }   // on an attack run: break, then back onto the same target
      else { p.mode = 'reposition'; p.modeT = rand(2.5, 4); this.release(p); }
    }
    if (p.mode === 'rejoin') p.mode = 'reposition';
    if (p.target && (!p.target.alive || p.target.hp - p.target.incoming <= 0)) this.release(p);   // dead, or the missiles in flight will do it
    if (p.mode === 'engage' && !p.target) { p.mode = 'reposition'; p.modeT = rand(0.5, 1.5); }
    if (p.mode === 'reposition' && p.modeT <= 0 && !p.maneuvering) {
      const t = this.firing ? this.pickTarget(p) : null;
      if (t) { p.target = t; t.chasers++; p.mode = 'engage'; p.modeT = 25; p.ready = 0; p.noAim = 0; p.extendT = 0; }
      else p.modeT = rand(1, 2);
    }
    if (p.mode === 'engage' && p.modeT <= 0) { this.release(p); p.mode = 'reposition'; p.modeT = 1; }   // taking too long
    // steering
    const t = p.target;
    if (p.mode === 'engage' && t && p.extendT > 0) {
      // too close to bring the nose onto it (it sits inside the turn): fly out, climb to attack height, turn in again
      p.extendT -= dt; p.ready = 0;
      if (t.ground && p.pos.distanceTo(t.pos) > 190) p.extendT = 0;   // a ground target: out until there is room to dive onto it
      if (p.extendT <= 0) p.noAim = -NOAIM_T;   // done: time to turn back in before it counts as circling again
      _D.subVectors(p.pos, t.pos).setY(0); if (_D.lengthSq() < 1) _D.copy(p.dir).setY(0); _D.normalize();
      _D.y = clamp((ATTACK_AGL - p.agl) * 0.01, -0.3, 0.4); _D.normalize();
    } else if (p.mode === 'engage' && t) {
      const d = p.pos.distanceTo(t.pos);
      _lp.copy(t.pos); if (t.vel) _lp.addScaledVector(t.vel, Math.min(2, d / 70));
      if (t.ground) {
        // ground run: approach at altitude, then a shallow dive onto it
        if (d > 230) _lp.y = t.pos.y + clamp(p.pos.y - t.pos.y, 55, 110); else _lp.y = t.pos.y + 3;
      }
      _D.subVectors(_lp, p.pos).normalize();
      if (t.ground && p.agl < 34 && _D.y < 0) _D.y = 0.15;
      _D.y = clamp(_D.y, -0.6, 0.6); _D.normalize();
      const aim = p.dir.dot(_tg.subVectors(t.pos, p.pos).normalize());
      const inRange = d > 35 && d < (t.ground ? 190 : 210) && aim > 0.86;
      p.ready = inRange && p.cd <= 0 && !p.maneuvering ? p.ready + dt : 0;
      p.noAim = inRange || d > 260 ? 0 : (p.noAim || 0) + dt;   // circling close without a shot → extend
      // a ground target too close and off the nose can't be dived onto from here: go out for a run at once
      if (t.ground && d < 130 && aim < 0.5 && !p.maneuvering) p.noAim = NOAIM_T + 1;
      if (p.noAim > NOAIM_T) { p.noAim = 0; p.extendT = t.ground ? 7 : rand(3, 4.5); }
      if (this.firing && p.ready > (this.mopT > 0 ? 0.7 : 1.6)) this.shoot(p);   // no beats (quiet music / mop-up): shoot anyway
      if (!p.maneuvering && (d < 26 || (t.ground && d < 45 && p.agl < 30))) { this.release(p); this.afterShot(p); }   // overshoot: break off
    } else if (this.isWing(p) && !p.maneuvering) this.cover(p, this.mate(p));
    else if (!p.maneuvering) {
      // a lead repositioning / nothing to do: extend, turn back toward the battle area, keep a sane altitude
      _c.subVectors(this.anchor, p.pos).setY(0); const far = _c.length();
      _D.copy(p.dir); if (far > AREA_R * 0.7) _D.lerp(_c.normalize(), clamp((far - AREA_R * 0.7) / 250, 0.2, 0.7));
      _D.y = clamp(_D.y + (70 - p.agl) * 0.006, -0.4, 0.5); _D.normalize();
    }
  },
  /* a wingman between attacks: on the lead's wing, a little behind (watching its six) */
  cover(p, lead) {
    _gv.crossVectors(lead.dir, UP); if (_gv.lengthSq() < 1e-4) _gv.crossVectors(lead.dir, lead.up); _gv.normalize();
    this.follow(p, _sl.copy(lead.pos).addScaledVector(lead.dir, -16).addScaledVector(_gv, p.idx === 1 ? -12 : 12), lead.dir, lead.speed);
    if (p.agl < 40) { _D.y = Math.min(0.5, _D.y + (40 - p.agl) * 0.006); _D.normalize(); }   // not down into the weeds after a low lead
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
    p.cd = rand(1.4, 2.4); p.ready = 0; t.incoming++; this.shots++; p.last = t; p.lastGen = t.gen;
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
  shift(dx, dz) { this.anchor.x -= dx; this.anchor.z -= dz; for (const p of this.planes) { p.pos.x -= dx; p.pos.z -= dz; p.trail.shift(dx, dz); } }
};

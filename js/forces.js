'use strict';
/* ===== Force: a side's units on the map (ENEMIES, ALLIES) =====
   Units are pooled slots per type (built on first use, never disposed: a label sprite, for aircraft a Plane and a
   trail). A unit is drawn as a schematic glyph (js/models.js): aircraft in their attitude with an altitude line,
   ground / sea units as a marker on the ground with a pole up to their name. States:
   live → struck (a blinking X, the name struck through, STRUCK_T) → fade (FADE_T) → freed; vanish() fades without the X;
   retreat() (after a fight): aircraft fly off, ground units stay, then they flicker out (the pole sinks) → freed.
   A new unit appears like a radar contact (APPEAR_T): a ping ring, the glyph flickers in, the pole / altitude line
   grows from the ground, the name types out.
   A type: { cls: 'air' | 'ground' | 'sea', glyph, scale, hp, speed, turn, names, w (weight in groups), fires, alt, max,
   pole (ground / sea: pole height, default POLE_H), boss (js/bosses.js) }. */
const POLE_H = 18;            // ground / sea units: a vertical line from the marker up to their name
const STRUCK_T = 1.8, FADE_T = 1.3, FAR_BEHIND = 950, APPEAR_T = 1.3, RETREAT_FLICK = 1.5;
const easeOut = u => 1 - (1 - u) * (1 - u) * (1 - u);
const flicker = t => (Math.floor(t * 22) % 3 === 0 ? 0.2 : 1);   // a stepped on/off pattern
const _fq = new V3(), _fx = new V3();
/* nearest item (anything with .pos) of list to p, within maxD, passing filter */
function nearestOf(list, p, maxD, filter) {
  let best = null, bd = maxD || Infinity;
  for (const e of list) { if (filter && !filter(e)) continue; const d = e.pos.distanceTo(p); if (d < bd) { bd = d; best = e; } }
  return best;
}
/* an air unit's wish D: kept between ±0.5 vertical, its own heading when D is zero, unit length */
function airWish(e, D) { D.y = clamp(D.y, -0.5, 0.5); if (D.lengthSq() < 1e-6) D.copy(e.plane.dir); return D.normalize(); }

class Force {
  constructor(types, colorKey) { this.types = types; this.colorKey = colorKey; this.list = []; this.slots = {}; this.spawned = 0; this.kills = 0; this.css = cssOf(this.color); }
  get color() { return PAL[this.colorKey]; }
  get alive() { let k = 0; for (const e of this.list) if (e.alive) k++; return k; }
  /* a free slot of a type (built on first use); null when the type's pool is full */
  slot(type) {
    const ty = this.types[type], pool = this.slots[type] || (this.slots[type] = []);
    let s = pool.find(x => !x.inUse);
    if (!s) {
      if (pool.length >= ty.max) return null;
      s = { type, ty, force: this, inUse: false, alive: false, ground: ty.cls !== 'air', vel: new V3(), label: makeLabel() };
      if (ty.cls === 'air') { s.plane = new Plane({ speed: ty.speed, turnRate: ty.turn, rollRate: 2 }); s.pos = s.plane.pos; s.trail = new Trail(scene, this.color); s.trail.gain = 0.5; s.trail.line.visible = false; }
      else s.pos = new V3();
      s.label.visible = false; scene.add(s.label);
      pool.push(s);
    }
    return s;
  }
  spawn(type, pos, heading, name) {
    const s = this.slot(type); if (!s) return null;
    s.gen = (s.gen || 0) + 1;   // a new life for this slot: missiles aimed at the previous one ignore it
    s.inUse = true; s.alive = true; s.state = 'live'; s.t = 0; s.hp = s.ty.hp || 1; s.incoming = 0; s.chasers = 0; s.cd = rand(2, 5); s.mode = 'cruise'; s.modeT = rand(4, 8);
    s.name = name || pick(s.ty.names); s.heading = heading; s.target = null; s.ace = false; s.mop = false; s.downed = false; s.hurt = false; s.full = false;
    setLabel(s.label, s.name, this.css, false);
    if (s.plane) { s.plane.place(pos, heading, 0); s.plane.speed = s.plane.tgtSpeed = s.ty.speed * CFG.speed / 100; s.plane.man = null; s.trail.reset(s.pos); s.vel.copy(s.plane.dir).multiplyScalar(s.plane.speed); }
    else { s.pos.set(pos.x, TERRAIN.height(pos.x, pos.z), pos.z); s.vel.set(0, 0, 0); }   // on the ground (ships: sea level)
    this.list.push(s); this.spawned++;
    return s;
  }
  free(s) { s.inUse = false; s.alive = false; s.label.visible = false; if (s.trail) s.trail.line.visible = false; const i = this.list.indexOf(s); if (i >= 0) this.list.splice(i, 1); }
  vanish(e) { e.alive = false; e.state = 'fade'; e.t = 0; this.onGone(e); }
  retreat(e) { if (e.state !== 'live') return; e.alive = false; e.state = 'retreat'; e.t = 0; e.retT = e.plane ? rand(4, 7) : 2.5; e.mop = false; this.onGone(e); }
  onGone(e) {}                        // a unit stops being a target (killed / vanished)
  damage(e, dmg) {
    if (!e.alive) return;
    e.hp -= dmg;
    const big = e.ty.boss ? 2 : 1;   // a boss: bigger hits and a bigger end
    if (e.hp > 0) { e.hurt = true; BURSTS.spawn(e.pos, this.color, 1.2 * big, false); return; }
    e.alive = false; e.state = 'struck'; e.t = 0; e.downed = true; this.kills++;
    this.onGone(e);
    BURSTS.spawn(e.ground ? _fq.set(e.pos.x, e.pos.y + 1.5, e.pos.z) : e.pos, this.color, (e.ground ? 3.5 : 3) * big, e.ground);
    setLabel(e.label, e.name, this.css, true);
  }

  /* ---- placement of groups (ground units only on land, ships only at sea, a minimum spacing) ---- */
  freeSpot(x, z, d) { return !this.list.some(e => e.ground && Math.hypot(e.pos.x - x, e.pos.z - z) < d); }
  groundGroup(c, n, kinds, spread, h) {
    h = h == null ? rand(0, TAU) : h; let made = 0;
    for (let tries = 0; made < n && tries < n * 8; tries++) {
      _fq.set(c.x + rand(-spread, spread), 0, c.z + rand(-spread, spread));
      if (!TERRAIN.isLand(_fq.x, _fq.z) || !this.freeSpot(_fq.x, _fq.z, 12)) continue;
      if (this.spawn(wpick(kinds.map(k => ({ k, w: this.types[k].w }))).k, _fq, h + rand(-0.4, 0.4))) made++;
    }
    return made;
  }
  seaGroup(c, n, kinds, spread, h) {
    h = h == null ? rand(0, TAU) : h; let made = 0;
    for (let tries = 0; made < n && tries < n * 8; tries++) {
      _fq.set(c.x + rand(-spread, spread), 0, c.z + rand(-spread, spread));
      if (!TERRAIN.isSea(_fq.x, _fq.z) || TERRAIN.land(_fq.x + Math.sin(h) * 40, _fq.z + Math.cos(h) * 40) > -0.03 || !this.freeSpot(_fq.x, _fq.z, 26)) continue;
      if (this.spawn(wpick(kinds.map(k => ({ k, w: this.types[k].w }))).k, _fq, h)) made++;
    }
    return made;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt; if (e.alive) e.cd -= dt;   // weapon cooldown: aircraft, ships and SAM sites alike
      if (e.state === 'struck' && e.t > STRUCK_T) { e.state = 'fade'; e.t = 0; }
      if ((e.state === 'fade' && e.t >= FADE_T) || (e.state === 'retreat' && e.t >= e.retT)) { this.free(e); continue; }
      if (e.plane) { if (e.state === 'live' || e.state === 'retreat') this.fly(e, dt); else if (e.downed) this.fall(e, dt); else this.coast(e, dt); }
      else if (e.state === 'live') this.crawl(e, dt);
      if (e.state === 'live' && e.pos.distanceTo(ROUTE.pos) > FAR_BEHIND) this.vanish(e);   // left far behind
    }
  }
  fly(e, dt) {}                       // air AI (subclass)
  /* steer an air unit toward the unit direction D (kept between ±0.5 vertical) and move it */
  steerAir(e, D, dt, rateMul) {
    airWish(e, D);
    e.plane.rateMul = rateMul || 1; e.plane.steer(D, dt); e.plane.move(dt);
    e.vel.copy(e.plane.dir).multiplyScalar(e.plane.speed);
    e.trail.update(dt, e.pos, true);
  }
  coast(e, dt) { e.plane.move(dt); e.trail.update(dt, e.pos, true); }   // vanishing (not shot down): straight on while it fades
  fall(e, dt) {   // shot down: tumble and fall while it fades
    const pl = e.plane; pl.man = null; pl.dir.y = Math.max(-0.8, pl.dir.y - dt * 0.6); pl.dir.normalize(); pl.up.applyAxisAngle(pl.dir, dt * 3); pl.orthoUp();
    pl.move(dt); e.trail.update(dt, e.pos, true);
  }
  /* tanks / ships crawl along their heading while the way ahead stays land / sea, else they turn */
  crawl(e, dt) {
    if (!e.ty.speed) return;
    _fq.set(Math.sin(e.heading), 0, Math.cos(e.heading));
    const nx = e.pos.x + _fq.x * 25, nz = e.pos.z + _fq.z * 25, ok = e.ty.cls === 'sea' ? TERRAIN.isSea(nx, nz) : TERRAIN.isLand(nx, nz);
    if (!ok) { e.heading += 0.6 * dt; e.vel.set(0, 0, 0); return; }
    e.vel.copy(_fq).multiplyScalar(e.ty.speed * CFG.speed / 100); e.pos.addScaledVector(e.vel, dt); e.pos.y = TERRAIN.height(e.pos.x, e.pos.z);
  }
  /* per frame: glyphs, altitude lines / poles, labels, cross-outs, appear / retreat animations */
  draw() {
    const c = this.color;
    for (const e of this.list) {
      const g = GLYPHS[e.ty.glyph];
      let a = 1, grow = 1, shown = true;   // alpha, pole / altitude-line height, label on
      if (e.state === 'fade') a = Math.max(0, 1 - e.t / FADE_T);
      else if (e.state === 'retreat') {
        const left = e.retT - e.t;
        if (left < RETREAT_FLICK) { const u = Math.max(0, left / RETREAT_FLICK); a = u * flicker(e.t); if (e.ground) grow = u; shown = a > 0.5; }
      } else if (e.state === 'live' && e.t < APPEAR_T) {
        this.appear(e, c); shown = this.typed(e);
        a = e.t < 0.5 ? flicker(e.t) : 1; grow = easeOut(Math.min(1, e.t / (APPEAR_T * 0.5)));
      } else if (e.state === 'live' && !e.full) { setLabel(e.label, e.name, this.css, false); e.full = true; }   // the whole name, once
      if (e.ground) {
        const y = e.pos.y, ph = e.ty.pole || POLE_H;
        drawMarker(g, e.pos.x, y, e.pos.z, e.heading, e.ty.scale, c, a, 2);
        if (CFG.dropLines) LINES.add(e.pos.x, y + 0.15, e.pos.z, e.pos.x, y + ph * grow, e.pos.z, c, 0.95 * a, 0.8 * a, 2.4);
        GLOW.dot(_fx.set(e.pos.x, y + 1.2, e.pos.z), 1.1, c, 0.9 * a);
        e.label.position.set(e.pos.x, y + (CFG.dropLines ? ph * grow : 3), e.pos.z);
      } else {
        drawGlyph(g, e.pos, e.plane.dir, e.plane.up, e.ty.scale, c, a, 2);
        if (CFG.dropLines) LINES.drop(e.pos, c, 0.8 * a, 2.2, grow);
        e.label.position.copy(e.pos).y += 2.5;
      }
      e.label.visible = CFG.labels && e.state !== 'fade' && shown;
      if (e.state === 'struck') {
        const r = Math.max(2.5, CAM.distTo(e.pos) * 0.022) * (e.ty.boss ? 2 : 1), blink = e.t < 0.6 ? (Math.floor(e.t * 10) % 2 ? 0.4 : 1) : 1;
        LINES.cross(e.ground ? _fx.set(e.pos.x, e.pos.y + 2.5, e.pos.z) : e.pos, r, c, blink);
      }
    }
  }
  /* appearing: a radar ping — a ring (flat on the ground / facing the camera for aircraft) and a smaller echo */
  appear(e, c) {
    const u = e.t / APPEAR_T, p = e.ground ? _fx.set(e.pos.x, e.pos.y + 0.2, e.pos.z) : e.pos;
    LINES.circle(p, 2 + 14 * easeOut(u), c, (1 - u) * 0.9, e.ground, 1.8, 28);
    if (e.t > 0.25) { const v = (e.t - 0.25) / (APPEAR_T - 0.25); LINES.circle(p, 1 + 9 * easeOut(v), c, (1 - v) * 0.6, e.ground, 1.4, 22); }
  }
  /* appearing: the name types out once the pole is up; false while nothing is shown yet */
  typed(e) {
    const k = clamp((e.t / APPEAR_T - 0.45) / 0.5, 0, 1), n = Math.ceil(e.name.length * k);
    if (!n) return false;
    setLabel(e.label, e.name.slice(0, n), this.css, false);
    return true;
  }
  recolor() {
    this.css = cssOf(this.color);
    for (const pool of Object.values(this.slots)) for (const s of pool) { if (s.trail) s.trail.recolor(this.color); if (s.inUse) setLabel(s.label, s.name, this.css, s.state === 'struck' || (s.state === 'fade' && s.downed)); }
  }
  shift(dx, dz) {
    for (const pool of Object.values(this.slots)) for (const s of pool) { s.pos.x -= dx; s.pos.z -= dz; if (s.trail) s.trail.shift(dx, dz); }
  }
  /* nearest live unit of this force to p (optional filter / max distance) */
  nearest(p, maxD, filter) { return nearestOf(this.list, p, maxD, e => e.alive && (!filter || filter(e))); }
}

'use strict';
/* ===== Enemies: types, waves, behaviour, hostile fire, destruction =====
   Units are pooled per type (slots built on first use, never disposed; each slot has its own line material so it can
   fade). Waves spawn ahead of the flight only while AUD.fighting: ground groups where the map ahead is land, ships
   where it is sea, air groups anywhere. A kill: burst, a red X over it and its name struck through, then it fades.
   Units left far behind, or air units after the fight, fade out quietly. Hostile missiles always lose lock. */
const ENEMY_TYPES = {
  fighter:   { cls: 'air', model: 'jet', scale: 1.6, hp: 1, speed: 23, turn: 0.55, names: ['MIG-29A', 'SU-30', 'SU-27', 'J-10C'], w: 4, fires: 'missile', alt: [50, 150], max: 10 },
  bomber:    { cls: 'air', model: 'heavy', scale: 1.7, hp: 3, speed: 15, turn: 0.18, names: ['TU-22M', 'H-6K'], w: 1, alt: [70, 130], max: 4 },
  attacker:  { cls: 'air', model: 'jet', scale: 1.4, hp: 1, speed: 18, turn: 0.4, names: ['SU-25', 'SU-34'], w: 1.5, alt: [35, 70], max: 6 },
  heli:      { cls: 'air', model: 'heli', scale: 1.6, hp: 1, speed: 8, turn: 0.35, names: ['MI-24', 'KA-52'], w: 1.2, alt: [28, 40], max: 6 },
  sam:       { cls: 'ground', model: 'sam', scale: 2.2, hp: 1, names: ['SAM'], w: 2, fires: 'missile', max: 8 },
  aagun:     { cls: 'ground', model: 'aagun', scale: 2.2, hp: 1, names: ['AA GUN'], w: 2.5, fires: 'guns', max: 8 },
  tank:      { cls: 'ground', model: 'tank', scale: 2.2, hp: 1, speed: 2, names: ['TANK'], w: 2, max: 8 },
  radar:     { cls: 'ground', model: 'radar', scale: 2.2, hp: 1, names: ['RADAR'], w: 0.8, max: 4 },
  frigate:   { cls: 'sea', model: 'frigate', scale: 1.25, hp: 2, speed: 3, names: ['FRIGATE', 'CORVETTE'], w: 2, fires: 'missile', max: 5 },
  destroyer: { cls: 'sea', model: 'destroyer', scale: 1.25, hp: 3, speed: 3, names: ['DESTROYER', 'CRUISER'], w: 1, fires: 'missile', max: 3 }
};
const POLE_H = 14;            // ground units: a vertical line from the ground up to their name
const STRUCK_T = 1.8, FADE_T = 1.3, FAR_BEHIND = 950;

const _e = new V3(), _f = new V3(), _r = new V3(), _q = new V3(), _ts = new V3(), _b = new V3();
const ENEMIES = {
  list: [], slots: {}, waveT: 0, fireT: 3, kills: 0, spawned: 0, missiles: 0, wasFighting: false,
  get cap() { return Math.round(clamp(16 * CFG.density / 100, 0, 36)); },
  get alive() { let k = 0; for (const e of this.list) if (e.alive) k++; return k; },
  /* a free slot of a type (built on first use); null when the type's pool is full */
  slot(type) {
    const ty = ENEMY_TYPES[type], pool = this.slots[type] || (this.slots[type] = []);
    let s = pool.find(x => !x.inUse);
    if (!s) {
      if (pool.length >= ty.max) return null;
      const lineMat = lineMaterial(PAL.enemy, 1), fillMat = modelGeo(ty.model).fill ? fillMaterial(PAL.enemy, 0.1) : null;
      s = { type, ty, lineMat, fillMat, inUse: false, ground: ty.cls !== 'air', vel: new V3() };
      s.model = buildModel(ty.model, lineMat, fillMat, ty.scale);
      s.label = makeLabel();
      if (ty.cls === 'air') { s.plane = new Plane({ speed: ty.speed, turnRate: ty.turn, rollRate: 2 }); s.plane.obj.add(s.model); s.obj = s.plane.obj; s.pos = s.plane.pos; s.trail = new Trail(scene, PAL.enemy); s.trail.gain = 0.55; s.trail.line.visible = false; }
      else { s.obj = new THREE.Group(); s.obj.add(s.model); s.pos = s.obj.position; }
      s.obj.visible = false; s.label.visible = false; scene.add(s.obj, s.label);
      pool.push(s);
    }
    return s;
  },
  spawn(type, pos, heading) {
    const s = this.slot(type); if (!s) return null;
    s.inUse = true; s.alive = true; s.state = 'live'; s.t = 0; s.hp = s.ty.hp; s.incoming = 0; s.chasers = 0; s.cd = rand(2, 5); s.mode = 'merge'; s.modeT = rand(4, 8);
    s.name = pick(s.ty.names); s.heading = heading; s.lineMat.opacity = 1; if (s.fillMat) s.fillMat.opacity = 0.1;
    setLabel(s.label, s.name, cssOf(PAL.enemy), false);
    if (s.plane) { s.plane.place(pos, heading, 0); s.plane.speed = s.plane.tgtSpeed = s.ty.speed * CFG.speed / 100; s.plane.man = null; s.trail.reset(s.pos); s.vel.copy(s.plane.dir).multiplyScalar(s.plane.speed); }
    else { s.pos.set(pos.x, 0, pos.z); s.obj.rotation.set(0, heading, 0); s.vel.set(0, 0, 0); }
    s.obj.visible = true; this.list.push(s); this.spawned++;
    return s;
  },
  free(s) { s.inUse = false; s.alive = false; s.obj.visible = false; s.label.visible = false; if (s.trail) s.trail.line.visible = false; const i = this.list.indexOf(s); if (i >= 0) this.list.splice(i, 1); },

  /* ---- waves ---- */
  wave() {
    const n0 = this.list.length, room = this.cap - this.alive; if (room <= 0) return;
    const heavy = AUD.heavy;
    _f.copy(ROUTE.fwd); _r.copy(ROUTE.right);
    const ahead = rand(380, 620), side = rand(-260, 260);
    _e.copy(ROUTE.pos).addScaledVector(_f, ahead).addScaledVector(_r, side);
    const land = TERRAIN.land(_e.x, _e.z), groundOk = land > 0.03, seaOk = land < -0.06;
    const airP = groundOk || seaOk ? 0.45 : 1;
    if (Math.random() < airP || CFG.density <= 0) this.airGroup(Math.min(room, randi(2, 3 + Math.round(heavy * 2))));
    else if (seaOk) this.seaGroup(_e, Math.min(room, randi(1, 3)));
    else this.groundGroup(_e, Math.min(room, randi(3, 5 + Math.round(heavy * 2))));
    return this.list.length - n0;
  },
  airGroup(n) {
    const type = wpick(['fighter', 'bomber', 'attacker', 'heli'].map(k => ({ k, w: ENEMY_TYPES[k].w }))).k, ty = ENEMY_TYPES[type];
    const ahead = type === 'heli' ? rand(300, 450) : rand(500, 750), side = rand(-300, 300);
    _e.copy(ROUTE.pos).addScaledVector(ROUTE.fwd, ahead).addScaledVector(ROUTE.right, side); _e.y = rand(ty.alt[0], ty.alt[1]);
    // they come at the flight, roughly
    const toward = Math.atan2(ROUTE.pos.x - _e.x, ROUTE.pos.z - _e.z) + rand(-0.5, 0.5);
    _r.set(Math.cos(toward), 0, -Math.sin(toward)); _b.set(Math.sin(toward), 0, Math.cos(toward));
    for (let i = 0; i < Math.min(n, type === 'bomber' ? 2 : 4); i++) {
      _q.copy(_e).addScaledVector(_r, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 12).addScaledVector(_b, -Math.ceil(i / 2) * 9);
      const s = this.spawn(type, _q, toward); if (s) s.mode = type === 'heli' ? 'hover' : 'merge';
    }
  },
  groundGroup(c, n) {
    const kinds = ['sam', 'aagun', 'tank', 'radar'];
    const h = rand(0, TAU);
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      _q.set(c.x + rand(-45, 45), 0, c.z + rand(-45, 45));
      if (!TERRAIN.isLand(_q.x, _q.z)) continue;
      if (this.list.some(e => e.ground && e.inUse && Math.hypot(e.pos.x - _q.x, e.pos.z - _q.z) < 12)) continue;
      const type = wpick(kinds.map(k => ({ k, w: ENEMY_TYPES[k].w }))).k;
      if (this.spawn(type, _q, h + rand(-0.4, 0.4))) i++;
    }
  },
  seaGroup(c, n) {
    const h = rand(0, TAU);
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      _q.set(c.x + rand(-70, 70), 0, c.z + rand(-70, 70));
      if (!TERRAIN.isSea(_q.x, _q.z) || TERRAIN.land(_q.x + Math.sin(h) * 40, _q.z + Math.cos(h) * 40) > -0.03) continue;
      if (this.list.some(e => e.ground && e.inUse && Math.hypot(e.pos.x - _q.x, e.pos.z - _q.z) < 30)) continue;
      if (this.spawn(Math.random() < 0.7 ? 'frigate' : 'destroyer', _q, h)) i++;
    }
  },

  update(dt) {
    const fighting = AUD.fighting;
    if (fighting && !this.wasFighting) this.waveT = 1.5;
    this.wasFighting = fighting;
    if (fighting && CFG.density > 0) {
      this.waveT -= dt;
      const want = Math.max(3, Math.round(this.cap * (0.45 + AUD.heavy * 0.4)));
      if (this.waveT <= 0 && this.alive < want) { this.wave(); this.waveT = rand(5, 9) / Math.max(0.3, CFG.density / 100); }
    }
    if (fighting) this.fireT = Math.max(-1, this.fireT - dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt;
      if (e.state === 'struck' && e.t > STRUCK_T) { e.state = 'fade'; e.t = 0; e.label.visible = false; }
      if (e.state === 'fade') {
        const a = 1 - e.t / FADE_T; e.lineMat.opacity = Math.max(0, a); if (e.fillMat) e.fillMat.opacity = Math.max(0, a * 0.1);
        if (e.t >= FADE_T) { this.free(e); continue; }
      }
      if (e.plane) this.fly(e, dt); else this.ground(e, dt);
      // left far behind the battle area / the flight: fade out quietly
      if (e.state === 'live' && e.pos.distanceTo(ROUTE.pos) > FAR_BEHIND) this.vanish(e);
      if (e.state === 'live' && !AUD.armed && e.plane && e.mode !== 'leave') { e.mode = 'leave'; e.modeT = rand(4, 8); }
    }
  },
  vanish(e) { e.alive = false; e.state = 'fade'; e.t = 0; e.label.visible = false; this.untarget(e); },
  untarget(e) { for (const p of SQUAD.planes) if (p.target === e) SQUAD.release(p); },
  fly(e, dt) {
    const pl = e.plane;
    if (e.state !== 'live') {   // shot down: tumble and fall while it fades
      pl.man = null; pl.dir.y = Math.max(-0.8, pl.dir.y - dt * 0.6); pl.dir.normalize(); pl.up.applyAxisAngle(pl.dir, dt * 3); pl.orthoUp();
      pl.move(dt); pl.sync(); e.trail.update(dt, e.pos, true); return;
    }
    e.modeT -= dt; e.cd -= dt;
    const tgt = this.nearestFriend(e.pos);
    if (e.mode === 'leave') { _q.subVectors(e.pos, ROUTE.pos).setY(0).normalize(); _q.y = 0.25; if (e.modeT <= 0) this.vanish(e); }
    else if (e.mode === 'hover') { _q.subVectors(ROUTE.pos, e.pos).setY(0); const d = _q.length(); _q.normalize(); if (d < 120) _q.applyAxisAngle(UP, 1.2); _q.y = (34 - e.pos.y) * 0.05; }
    else if (e.type === 'bomber' || e.type === 'attacker') { _q.copy(pl.dir); _q.y = (ENEMY_TYPES[e.type].alt[0] + 20 - e.pos.y) * 0.01; }
    else {   // fighters: merge, then dogfight with jinks
      if (e.mode === 'merge' && tgt && e.pos.distanceTo(tgt.pos) < 180) { e.mode = 'dogfight'; e.modeT = rand(3, 6); }
      if (e.mode === 'dogfight' && e.modeT <= 0) { e.modeT = rand(4, 8); if (Math.random() < 0.5) tryManeuver(pl, ['breakTurn', 'barrel', 'splitS', 'immelmann']); }
      _q.subVectors(tgt ? tgt.pos : ROUTE.pos, e.pos).normalize();
      if (e.pos.distanceTo(ROUTE.pos) > 600) _q.subVectors(ROUTE.pos, e.pos).normalize();
    }
    _q.y = clamp(_q.y, -0.5, 0.5); if (_q.lengthSq() < 1e-6) _q.copy(pl.dir); _q.normalize();
    pl.rateMul = e.mode === 'dogfight' ? 1.5 : 1;
    pl.steer(_q, dt); pl.move(dt); pl.sync();
    e.vel.copy(pl.dir).multiplyScalar(pl.speed);
    e.trail.update(dt, e.pos, true);
  },
  ground(e, dt) {
    if (e.state !== 'live' || !e.ty.speed) return;
    // tanks / ships crawl along their heading while the way ahead stays land / sea
    _q.set(Math.sin(e.heading), 0, Math.cos(e.heading));
    const nx = e.pos.x + _q.x * 25, nz = e.pos.z + _q.z * 25, ok = e.ty.cls === 'sea' ? TERRAIN.isSea(nx, nz) : TERRAIN.isLand(nx, nz);
    if (!ok) { e.heading += 0.6 * dt; e.obj.rotation.y = e.heading; e.vel.set(0, 0, 0); return; }
    e.vel.copy(_q).multiplyScalar(e.ty.speed); e.pos.addScaledVector(e.vel, dt);
  },
  nearestFriend(p, maxD) {
    let best = null, bd = maxD || Infinity;
    for (const f of SQUAD.planes) { const d = f.pos.distanceTo(p); if (d < bd) { bd = d; best = f; } }
    return best;
  },
  /* ---- hostile fire (beats; never more often than every couple of seconds) ---- */
  onBeat(band) {
    if (!CFG.enemyFire) return;
    if (band === 'mid' && Math.random() < 0.5) {   // AA guns: streams that miss
      const guns = this.list.filter(e => e.alive && e.ty.fires === 'guns');
      for (const g of guns) {
        const f = this.nearestFriend(g.pos, 220); if (!f) continue;
        _q.set(g.pos.x, 4, g.pos.z);
        _r.subVectors(f.pos, _q).normalize().add(new V3(rand(-0.12, 0.12), rand(0.05, 0.15), rand(-0.12, 0.12))).normalize().multiplyScalar(90);
        for (let i = 0; i < 3; i++) TRACERS.spawn(_q.clone().addScaledVector(_r, i * 0.03), _r, 2.2, true);
      }
    }
    if (band === 'low' || this.fireT > 0) return;
    const shooters = this.list.filter(e => e.alive && e.ty.fires === 'missile' && e.cd <= 0 && this.nearestFriend(e.pos, e.plane ? 200 : 300));
    if (!shooters.length) return;
    const s = pick(shooters), f = this.nearestFriend(s.pos, 300);
    if (s.plane) { _r.subVectors(f.pos, s.pos).normalize(); if (s.plane.dir.dot(_r) < 0.5) return; _q.copy(s.pos).addScaledVector(s.plane.dir, 2); _r.copy(s.plane.dir); }
    else { _q.set(s.pos.x, s.ty.cls === 'sea' ? 4 : 3, s.pos.z); _r.subVectors(f.pos, _q).normalize(); _r.y = Math.max(_r.y, 0.4); _r.normalize(); }
    MISSILES.fire({ p: _q, d: _r, speed: s.plane ? s.plane.speed + 5 : 12, target: f, hit: false, enemy: true });
    GLOW.spawn(_q, { c: PAL.enemy, s: 3, life: 0.3 });
    SQUAD.threat(f);
    s.cd = rand(5, 9); this.fireT = rand(2, 4.5); this.missiles++;
  },
  damage(e, dmg) {
    if (!e.alive) return;
    e.hp -= dmg;
    if (e.hp > 0) { BURSTS.spawn(e.pos, PAL.enemy, 1.2, false); return; }
    e.alive = false; e.state = 'struck'; e.t = 0; this.kills++;
    this.untarget(e);
    BURSTS.spawn(e.ground ? _q.set(e.pos.x, 1.5, e.pos.z) : e.pos, PAL.enemy, e.ground ? 3.5 : 3, e.ground);
    setLabel(e.label, e.name, cssOf(PAL.enemy), true);
  },
  /* per frame: altitude lines / poles, labels, cross-outs */
  draw() {
    const c = PAL.enemy;
    for (const e of this.list) {
      const a = e.state === 'fade' ? Math.max(0, 1 - e.t / FADE_T) : 1;
      if (e.ground) {
        if (CFG.dropLines) LINES.add(e.pos.x, 0, e.pos.z, e.pos.x, POLE_H, e.pos.z, c, 0.75 * a, 0.25 * a);
        e.label.position.set(e.pos.x, POLE_H + 0.5, e.pos.z);
      } else {
        if (CFG.dropLines) LINES.drop(e.pos, c, 0.7 * a);
        e.label.position.copy(e.pos).y += 2.2;
      }
      e.label.visible = CFG.labels && e.state !== 'fade';
      if (e.state === 'struck') {
        const r = Math.max(2.5, CAM.distTo(e.pos) * 0.022), blink = e.t < 0.6 ? (Math.floor(e.t * 10) % 2 ? 0.4 : 1) : 1;
        LINES.cross(e.ground ? _ts.set(e.pos.x, POLE_H * 0.5, e.pos.z) : e.pos, r, c, blink);
      }
    }
  },
  recolor() {
    for (const pool of Object.values(this.slots)) for (const s of pool) { s.lineMat.color.copy(PAL.enemy); if (s.fillMat) s.fillMat.color.copy(PAL.enemy); if (s.trail) s.trail.recolor(PAL.enemy); if (s.inUse) setLabel(s.label, s.name, cssOf(PAL.enemy), s.state !== 'live'); }
  },
  shift(dx, dz) {
    for (const pool of Object.values(this.slots)) for (const s of pool) { s.pos.x -= dx; s.pos.z -= dz; if (s.plane) s.plane.sync(); if (s.trail) s.trail.shift(dx, dz); }
  }
};

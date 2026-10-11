'use strict';
/* ===== Bosses: Ace Combat superweapons and aces =====
   Every CFG.bossEvery minutes of combat with music (BOSSES.t counts only while AUD.fighting) the next wave is a boss
   instead: one unit of BOSS_HP that takes that many hits (missiles, guns, allied fire alike), with its escort, the kind
   the map allows (ground ones on land, sea ones at sea, aircraft anywhere). Each has one show-off attack on the beat
   (e.sp cooldown) that, like all hostile fire, never hits: railgun shells bursting in the air near the flight,
   kinetic rounds into the ground, lasers past it, missile salvos that lose lock, drones launched into the fight.
   After the music a boss is mopped up like anything else — or, more likely, gets away (retreat).
   Boss types live in ENEMY_TYPES (same pools and states as any enemy): boss: true, ai (air: 'orbit' circles the
   flight's route point, 'solg' sinks in long passes over it, 'ace' flies the fighter AI as an ace), special, escort. */
const BOSS_HP = 10;
const SOLG_LOW = 110, SOLG_SINK = 1.0;   // SOLG: the height (AGL) it sinks to, units / s on the way down
const SHELL_N = 32, BEAM_N = 4, BEAM_L = 700;
Object.assign(ENEMY_TYPES, {
  // MQ-101: Arsenal Bird's drones (not in the regular air groups)
  drone:      { cls: 'air', glyph: 'arrow', scale: 1.4, hp: 1, speed: 25, turn: 0.6, names: ['MQ-101'], w: 1, fires: 'missile', alt: [60, 140], max: 6 },
  arsenal:    { cls: 'air', boss: true, ai: 'orbit', R: 260, special: 'drones', glyph: 'arsenal', scale: 6.5, hp: BOSS_HP, speed: 9, turn: 0.12, names: ['ARSENAL BIRD'], w: 1, alt: [140, 175], max: 1,
                escort: { kinds: ['drone'], n: [2, 2] } },
  cruiser:    { cls: 'air', boss: true, ai: 'orbit', R: 220, special: 'nimbus', glyph: 'cruiser', scale: 5.5, hp: BOSS_HP, speed: 10, turn: 0.14, names: ['P-1112 AIGAION', 'XB-0 HRESVELGR'], w: 1, alt: [120, 160], max: 1,
                escort: { kinds: ['fighter'], n: [2, 4] } },
  solg:       { cls: 'air', boss: true, ai: 'solg', special: 'kinetic', glyph: 'solg', scale: 5, hp: BOSS_HP, speed: 7, turn: 0.08, names: ['SOLG'], w: 1, alt: [200, 230], max: 1,
                escort: { kinds: ['fighter'], n: [2, 4], call: ['GRABACR', 'OFNIR'] } },
  superace:   { cls: 'air', boss: true, ai: 'ace', special: 'laser', glyph: 'arrow', scale: 2.0, hp: BOSS_HP, speed: 26, turn: 0.7, names: ['MORGAN', 'NOSFERATU', 'FALKEN', 'MR. X'], w: 1, alt: [60, 140], max: 1,
                escort: { kinds: ['fighter'], n: [1, 2], call: ACE_CALLSIGNS } },
  stonehenge: { cls: 'ground', boss: true, special: 'railgun', glyph: 'stonehenge', scale: 6, hp: BOSS_HP, names: ['STONEHENGE'], w: 1, pole: 26, max: 1,
                escort: { kinds: ['sam', 'aagun'], n: [3, 5] } },
  excalibur:  { cls: 'ground', boss: true, special: 'beam', glyph: 'excalibur', scale: 4.5, hp: BOSS_HP, names: ['EXCALIBUR'], w: 1, pole: 60, max: 1,
                escort: { kinds: ['sam', 'aagun', 'radar'], n: [3, 5] } },
  landship:   { cls: 'ground', boss: true, special: 'salvo', glyph: 'landship', scale: 6.5, hp: BOSS_HP, speed: 1.5, names: ['XANTHOS', 'BALIOS'], w: 1, aa: true, pole: 24, max: 1,
                escort: { kinds: ['tank', 'aagun'], n: [3, 5] } },
  subcarrier: { cls: 'sea', boss: true, special: 'burst', glyph: 'subcarrier', scale: 5.5, hp: BOSS_HP, speed: 2.5, names: ['SCINFAXI', 'HRIMFAXI'], w: 1, pole: 24, max: 1,
                escort: { kinds: ['frigate'], n: [1, 2] } },
  alicorn:    { cls: 'sea', boss: true, special: 'railgun', glyph: 'alicorn', scale: 6, hp: BOSS_HP, speed: 2, names: ['ALICORN'], w: 1, aa: true, pole: 26, max: 1,
                escort: { kinds: ['frigate', 'destroyer'], n: [1, 2] } }
});
const BOSS_KINDS = Object.keys(ENEMY_TYPES).filter(k => ENEMY_TYPES[k].boss);
const _bp = new V3(), _bq = new V3(), _bd = new V3(), _br = new V3(), _bf = new V3(), _bo = new V3();
/* a point given in a boss's glyph coordinates (x side, y up, z forward; × scale) in the world */
function bossPoint(e, x, y, z, out) {
  const s = e.ty.scale;
  if (e.plane) { const P = e.plane; _br.crossVectors(P.up, P.dir); return out.copy(e.pos).addScaledVector(_br, x * s).addScaledVector(P.up, y * s).addScaledVector(P.dir, z * s); }
  const sh = Math.sin(e.heading), ch = Math.cos(e.heading);
  return out.set(e.pos.x + (x * ch + z * sh) * s, e.pos.y + 0.15 + y * s, e.pos.z + (-x * sh + z * ch) * s);
}

/* Excalibur's tower: a broad blade standing point down in its base, the crossguard, the grip, the radome as the pommel */
const _bx = new V3(), _bz = new V3();
function bladeDraw(p, h, H, s, c, a, lit) {
  const y = p.y + 0.15, w = 0.5 * s, d = 0.08 * s, top = H * 0.8;
  _bx.set(Math.cos(h), 0, -Math.sin(h)); _bz.set(Math.sin(h), 0, Math.cos(h));
  const P = (x, yy, z) => [p.x + _bx.x * x + _bz.x * z, y + yy, p.z + _bx.z * x + _bz.z * z];
  const L = (q0, q1, k) => LINES.add(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], c, a * k, a * k, 1.8);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) L(P(x * w * 0.6, 0, z * d), P(x * w, top, z * d), 0.8);   // the blade, broader up to the guard
  L(P(-w, top, -d), P(w, top, -d), 0.8); L(P(-w, top, d), P(w, top, d), 0.8);
  L(P(-w * 1.9, top, 0), P(w * 1.9, top, 0), 1);   // the crossguard
  L(P(-0.12 * s, top, 0), P(-0.12 * s, H, 0), 0.9); L(P(0.12 * s, top, 0), P(0.12 * s, H, 0), 0.9);   // the grip
  const q = P(0, H + 0.25 * s, 0); _bx.set(q[0], q[1], q[2]);
  LINES.circle(_bx, 0.25 * s, c, a, false, 1.6, 12);   // the radome
  if (lit) GLOW.dot(_bx, 2, c, 0.9 * a);
}

const BOSSES = {
  t: 0, last: null,
  shells: [], si: 0, beams: [],
  build() {
    for (let i = 0; i < SHELL_N; i++) this.shells.push({ on: false, p: new V3(), v: new V3(), g: 0, fuse: 0, r: 3, ground: false, look: 'rail' });
    for (let i = 0; i < BEAM_N; i++) this.beams.push({ on: false, src: null, gen: 0, top: false, a: new V3(), b: new V3(), t: 0, life: 1 });
  },
  get boss() { for (const e of ENEMIES.list) if (e.alive && e.ty.boss) return e; return null; },
  due() { return CFG.bossEvery > 0 && this.t >= CFG.bossEvery * 60 && !this.boss; },

  /* ---- arrival: the boss ahead of the route, then its escort ---- */
  wave() {
    const room = ENEMIES.cap - ENEMIES.alive; if (room < 1) return false;
    for (let tries = 0; tries < 6; tries++) {
      _bp.copy(ROUTE.pos).addScaledVector(ROUTE.fwd, rand(420, 600)).addScaledVector(ROUTE.right, rand(-220, 220));
      const land = TERRAIN.land(_bp.x, _bp.z);
      let kinds = BOSS_KINDS.filter(k => { const c = ENEMY_TYPES[k].cls; return c === 'air' || (c === 'ground' ? land > 0.05 : land < -0.08); });
      if (kinds.length > 1) kinds = kinds.filter(k => k !== this.last);
      const type = pick(kinds), b = this.spawnType(type, _bp); if (!b) continue;
      this.escort(b, room - 1); this.t = 0; this.last = type;
      return true;
    }
    return false;
  },
  /* one boss of a type at (or near) at — default ahead of the route; null when the terrain there doesn't fit */
  spawnType(type, at) {
    const ty = ENEMY_TYPES[type], E = ENEMIES;
    if (!at) at = _bp.copy(ROUTE.pos).addScaledVector(ROUTE.fwd, 500);
    const h = Math.atan2(ROUTE.pos.x - at.x, ROUTE.pos.z - at.z) + rand(-0.5, 0.5);   // toward the flight, roughly
    let b = null;
    if (ty.cls === 'air') { _bq.copy(at); _bq.y = Math.min(TERRAIN.height(at.x, at.z) + rand(ty.alt[0], ty.alt[1]), CEIL - 40); b = E.spawn(type, _bq, h); }
    else for (let i = 0; i < 16 && !b; i++) {   // on the right terrain: at the point itself, else somewhere near it
      const x = at.x + (i ? rand(-60, 60) : 0), z = at.z + (i ? rand(-60, 60) : 0);
      if (ty.cls === 'sea' ? !TERRAIN.isSea(x, z) || TERRAIN.land(x + Math.sin(h) * 40, z + Math.cos(h) * 40) > -0.03 : !TERRAIN.isLand(x, z)) continue;
      if (E.freeSpot(x, z, 20)) b = E.spawn(type, _bq.set(x, 0, z), h);
    }
    if (!b) return null;
    b.sp = ty.ai === 'ace' ? rand(1.5, 3) : rand(4, 7); b.osense = Math.random() < 0.5 ? -1 : 1;
    if (b.plane) b.balt = b.plane.agl;
    if (ty.ai === 'ace') { b.ace = true; b.mode = 'merge'; }
    return b;
  },
  escort(b, room) {
    const es = b.ty.escort; if (!es || room < 1) return 0;
    const n = Math.min(room, randi(es.n[0], es.n[1])), cls = ENEMY_TYPES[es.kinds[0]].cls;
    if (cls === 'air') { const ty = ENEMY_TYPES[es.kinds[0]]; _bq.copy(b.pos); _bq.y = TERRAIN.height(b.pos.x, b.pos.z) + rand(ty.alt[0], ty.alt[1]); return this.air(es.kinds[0], n, _bq, b.plane ? b.plane.dir : ROUTE.fwd, es.call ? pick(es.call) : null); }
    return this.around(b, n, es.kinds);
  },
  /* an air group in a loose vee at c, heading along dir (call: an ace squadron's callsign) */
  air(type, n, c, dir, call) {
    const h = Math.atan2(dir.x, dir.z); let made = 0;
    _br.set(Math.cos(h), 0, -Math.sin(h)); _bf.set(Math.sin(h), 0, Math.cos(h));
    for (let i = 0; i < n; i++) {
      _bo.copy(c).addScaledVector(_br, (i % 2 ? 1 : -1) * (10 + Math.floor(i / 2) * 14)).addScaledVector(_bf, -8 - Math.floor(i / 2) * 10);
      _bo.y = clamp(_bo.y, TERRAIN.height(_bo.x, _bo.z) + FLOOR + 10, CEIL - 30);
      const s = ENEMIES.spawn(type, _bo, h, call ? `${call} ${i + 1}` : null); if (!s) continue;
      s.mode = 'merge'; if (call) { s.ace = true; s.hp += 1; }
      made++;
    }
    return made;
  },
  /* ground / sea escorts around a boss (clear of its glyph) */
  around(b, n, kinds) {
    const sea = b.ty.cls === 'sea', r0 = b.ty.scale * 2.2 + 10; let made = 0;
    for (let tries = 0; made < n && tries < n * 10; tries++) {
      const a = rand(0, TAU), r = rand(r0, r0 + 50), x = b.pos.x + Math.sin(a) * r, z = b.pos.z + Math.cos(a) * r;
      if (sea ? !TERRAIN.isSea(x, z) || TERRAIN.land(x + Math.sin(b.heading) * 40, z + Math.cos(b.heading) * 40) > -0.03 : !TERRAIN.isLand(x, z)) continue;
      if (!ENEMIES.freeSpot(x, z, sea ? 26 : 12) || Math.hypot(x - b.pos.x, z - b.pos.z) < r0) continue;
      if (ENEMIES.spawn(wpick(kinds.map(k => ({ k, w: ENEMY_TYPES[k].w }))).k, _bo.set(x, 0, z), b.heading + (sea ? 0 : rand(-0.4, 0.4)))) made++;
    }
    return made;
  },

  /* ---- flying (EnemyForce.fly): the wish D for 'orbit' / 'solg' bosses ---- */
  wish(e, D) {
    const ty = e.ty, P = e.plane;
    _bd.subVectors(e.pos, ROUTE.pos).setY(0); const d = Math.max(1, _bd.length()); _bd.divideScalar(d);
    if (ty.ai === 'orbit') {   // round the flight's route point: the tangent, pulled in / out to the radius
      D.set(-_bd.z * e.osense, 0, _bd.x * e.osense).addScaledVector(_bd, clamp((ty.R - d) / ty.R, -1, 1) * 1.2);
      D.y = clamp((e.balt - P.agl) * 0.01, -0.3, 0.3);
    } else {   // SOLG out of orbit: long straight passes over the fight, a little lower each time
      if (d > 200) D.copy(_bd).negate(); else D.copy(P.dir).setY(0);
      D.y = clamp((Math.max(SOLG_LOW, e.balt - e.t * SOLG_SINK) - P.agl) * 0.02, -0.12, 0.12);
    }
  },

  /* ---- specials on the beat (from ENEMIES.onBeat, only while fighting) ---- */
  onBeat(band) {
    if (!AUD.fighting) return;
    for (const e of ENEMIES.list) {
      if (!e.alive || !e.ty.special || e.t < APPEAR_T || e.sp > 0) continue;
      const f = ENEMIES.nearestFriend(e.pos, e.plane ? 380 : 450); if (!f) continue;
      if (this.special(e, f, band)) e.sp = rand(6, 10) * (e.ty.ai === 'ace' ? 0.7 : 1);
    }
  },
  special(e, f, band) {
    const ty = e.ty;
    switch (ty.special) {
      case 'drones': {   // Arsenal Bird: a pair of MQ-101 out of the bay (a salvo when there's no room for more)
        const room = ENEMIES.cap - ENEMIES.alive;
        if (room < 1) return this.salvo(e, 2);
        bossPoint(e, 0, -0.4, 0, _bq); this.air('drone', Math.min(2, room), _bq, e.plane.dir, null);
        GLOW.spawn(_bq, { c: PAL.enemy, s: 5, life: 0.4 });
        return true;
      }
      case 'nimbus': return band !== 'high' && this.salvo(e, 4);   // Aigaion: one missile at every plane in range
      case 'kinetic':   // SOLG: rounds down into the ground around the flight
        bossPoint(e, 0, 0, 2.7, _bp); GLOW.spawn(_bp, { c: PAL.enemy, s: 5, life: 0.4 });
        for (let i = 0; i < 3; i++) { this.miss(f, rand(45, 100), _bq); _bq.y = TERRAIN.height(_bq.x, _bq.z) - 1; this.shell(_bp, _bq, 85, 0, 'kin', 4.5, true); }
        return true;
      case 'laser': {   // the ace: only with its nose on a plane, a beam just past it
        _bd.subVectors(f.pos, e.pos); const d = _bd.length();
        if (d > 300 || e.plane.dir.dot(_bd.normalize()) < 0.7) return false;
        this.miss(f, rand(9, 15), _bq); bossPoint(e, 0, 0, 2.3, _bp);
        return this.beam(e, false, _bd.subVectors(_bq, _bp).normalize(), _bd, 0.8);
      }
      case 'beam': {   // Excalibur: from the top of the tower, a sweep just over the flight
        _bp.set(e.pos.x, e.pos.y + ty.pole + 0.25 * ty.scale, e.pos.z);
        _bf.subVectors(f.pos, _bp).setY(0).normalize(); _br.set(_bf.z, 0, -_bf.x);
        _bq.copy(f.pos).addScaledVector(_br, 45).y += rand(16, 24); _bd.subVectors(_bq, _bp).normalize();
        _bq.addScaledVector(_br, -90); _bo.subVectors(_bq, _bp).normalize();
        return this.beam(e, true, _bd, _bo, 1.6);
      }
      case 'railgun': {   // Stonehenge (the gun facing the flight) / Alicorn (the bow gun): a shell bursting near the flight
        if (e.ty.glyph === 'stonehenge') {
          _bd.subVectors(f.pos, e.pos); const sh = Math.sin(e.heading), ch = Math.cos(e.heading);
          const a = Math.round(Math.atan2(_bd.x * sh + _bd.z * ch, _bd.x * ch - _bd.z * sh) / (TAU / 8)) * (TAU / 8);
          bossPoint(e, Math.cos(a) * 1.9, 0.2, Math.sin(a) * 1.9, _bp);
        } else bossPoint(e, 0, 0.3, 4.0, _bp);
        this.miss(f, rand(22, 40), _bq); this.shell(_bp, _bq, 110, 25, 'rail', 3.5, false);
        GLOW.spawn(_bp, { c: PAL.enemy, s: 5, life: 0.35 });
        return true;
      }
      case 'salvo':   // Land Battleship: all three turrets
        for (const z of [1.3, 0.4, -1.5]) { bossPoint(e, 0, 0.3, z, _bp); this.miss(f, rand(22, 45), _bq); this.shell(_bp, _bq, rand(95, 115), 25, 'rail', 3, false); GLOW.spawn(_bp, { c: PAL.enemy, s: 4, life: 0.3 }); }
        return true;
      case 'burst': {   // Scinfaxi: burst missiles out of the deck, a big airburst near the flight
        for (let i = 0; i < 3; i++) { bossPoint(e, 0, 0.3, 1.6 - i * 0.6, _bp); this.miss(f, rand(28, 45), _bq); this.shell(_bp, _bq, 45, 0, 'msl', 5, false); }
        SQUAD.threat(f); ENEMIES.missiles++;
        return true;
      }
    }
    return false;
  },
  /* a missile from under the boss at every plane within range (they lose lock, the planes break and flare) */
  salvo(e, n) {
    let k = 0;
    for (const p of SQUAD.planes) {
      if (k >= n || p.pos.distanceTo(e.pos) > 420) continue;
      bossPoint(e, rand(-1.5, 1.5), -0.3, rand(-0.5, 0.5), _bp); _bd.subVectors(p.pos, _bp).normalize();
      if (!MISSILES.fire({ p: _bp, d: _bd, speed: e.plane.speed + 6, target: p, hit: false, enemy: true })) break;
      GLOW.spawn(_bp, { c: PAL.enemy, s: 3, life: 0.3 }); SQUAD.threat(p); ENEMIES.missiles++; k++;
    }
    return k > 0;
  },
  /* a point near plane f, d away from it (mostly beside / above, never on it) */
  miss(f, d, out) { _bo.set(rand(-1, 1), rand(0.1, 0.8), rand(-1, 1)).normalize(); return out.copy(f.pos).addScaledVector(_bo, d); },
  /* a shell from p to q at speed sp under gravity g (an arc that gets there): a burst there, or on the ground */
  shell(p, q, sp, g, look, r, ground) {
    const s = this.shells[this.si]; this.si = (this.si + 1) % SHELL_N;
    const tt = Math.max(0.2, p.distanceTo(q) / sp);
    s.on = true; s.p.copy(p); s.v.subVectors(q, p).divideScalar(tt); s.v.y += 0.5 * g * tt; s.g = g; s.fuse = tt; s.look = look; s.r = r; s.ground = ground;
    return s;
  },
  beam(src, top, a, b, life) {
    const m = this.beams.find(x => !x.on); if (!m) return false;
    m.on = true; m.src = src; m.gen = src.gen; m.top = top; m.a.copy(a); m.b.copy(b); m.t = 0; m.life = life;
    return true;
  },

  /* ---- simulation: cooldowns, shells, beams ---- */
  update(dt) {
    for (const e of ENEMIES.list) if (e.alive && e.ty.special) e.sp -= dt;
    for (const s of this.shells) {
      if (!s.on) continue;
      s.fuse -= dt; s.v.y -= s.g * dt; s.p.addScaledVector(s.v, dt);
      if (s.ground) {
        const gy = s.p.y < HMAX ? TERRAIN.height(s.p.x, s.p.z) : -1;
        if (s.p.y <= gy) { s.on = false; s.p.y = gy; BURSTS.spawn(s.p, PAL.enemy, s.r, true); }
        else if (s.fuse < -6) s.on = false;
      } else if (s.fuse <= 0) { s.on = false; BURSTS.spawn(s.p, PAL.enemy, s.r, false); }
    }
    for (const m of this.beams) if (m.on && ((m.t += dt) >= m.life || !m.src.alive || m.src.gen !== m.gen)) m.on = false;
  },
  /* ---- per frame: Excalibur's tower, shells, beams ---- */
  draw() {
    const c = PAL.enemy;
    for (const e of ENEMIES.list) {   // Excalibur's blade
      if (e.ty.special !== 'beam') continue;
      const a = e.state === 'fade' ? Math.max(0, 1 - e.t / FADE_T) : e.state === 'retreat' ? clamp((e.retT - e.t) / RETREAT_FLICK, 0, 1) : 1;
      const grow = e.state === 'live' && e.t < APPEAR_T ? easeOut(Math.min(1, e.t / (APPEAR_T * 0.5))) : 1;
      bladeDraw(e.pos, e.heading, e.ty.pole * grow, e.ty.scale, c, a, e.alive);
    }
    for (const s of this.shells) {
      if (!s.on) continue;
      const k = s.look === 'msl' ? 0.3 : 0.06;
      LINES.add(s.p.x, s.p.y, s.p.z, s.p.x - s.v.x * k, s.p.y - s.v.y * k, s.p.z - s.v.z * k, c, 1, 0.1, s.look === 'msl' ? 1.4 : 2.2);
      GLOW.dot(s.p, s.look === 'msl' ? 1.4 : 1.8, s.look === 'msl' ? c : PAL.flare, 1);
    }
    for (const m of this.beams) {
      if (!m.on) continue;
      const u = m.t / m.life, a = (u < 0.12 ? flicker(m.t) : 1) * (1 - smoothstep(0.7, 1, u));
      _bd.copy(m.a).lerp(m.b, smoothstep(0, 1, u)).normalize();
      if (m.top) _bp.set(m.src.pos.x, m.src.pos.y + m.src.ty.pole + 0.25 * m.src.ty.scale, m.src.pos.z); else bossPoint(m.src, 0, 0, 2.3, _bp);
      _bq.copy(_bp).addScaledVector(_bd, BEAM_L);
      LINES.add(_bp.x, _bp.y, _bp.z, _bq.x, _bq.y, _bq.z, c, a, a * 0.2, 3.4);
      LINES.add(_bp.x, _bp.y, _bp.z, _bq.x, _bq.y, _bq.z, PAL.white, a * 0.8, a * 0.1, 1.1);
      GLOW.dot(_bp, 2.6, c, a);
    }
  },
  shift(dx, dz) { for (const s of this.shells) { s.p.x -= dx; s.p.z -= dz; } }
};

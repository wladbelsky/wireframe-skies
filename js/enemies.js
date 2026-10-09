'use strict';
/* ===== Enemies: types, waves, behaviour, hostile fire =====
   Waves spawn ahead of the flight only while AUD.fighting: ground groups where the map ahead is land, ships where it
   is sea, air groups anywhere. After a fight they retreat (see SQUAD.startMopUp). Hostile missiles always lose lock.
   An air group is one aircraft type under one name; ACE_P of fighter / attack groups are aces: a squadron callsign
   (`SHADOW 1…4`), one more hit to bring down, sharper turns, more frequent jinks and shots. */
const ENEMY_TYPES = {
  fighter:   { cls: 'air', glyph: 'arrow', scale: 2.0, hp: 1, speed: 23, turn: 0.55, names: ['MIG-29A', 'SU-30', 'SU-27', 'J-10C'], w: 4, fires: 'missile', alt: [50, 150], max: 10 },
  bomber:    { cls: 'air', glyph: 'heavy', scale: 1.7, hp: 3, speed: 15, turn: 0.18, names: ['TU-22M', 'H-6K'], w: 1, alt: [70, 130], max: 4 },
  attacker:  { cls: 'air', glyph: 'arrow', scale: 1.8, hp: 1, speed: 18, turn: 0.4, names: ['SU-25', 'SU-34'], w: 1.5, alt: [35, 70], max: 6 },
  heli:      { cls: 'air', glyph: 'heli', scale: 1.5, hp: 1, speed: 8, turn: 0.35, names: ['MI-24', 'KA-52'], w: 1.2, alt: [28, 40], max: 6 },
  sam:       { cls: 'ground', glyph: 'sam', scale: 2.2, hp: 1, names: ['SAM'], w: 2, fires: 'missile', max: 8 },
  aagun:     { cls: 'ground', glyph: 'aagun', scale: 1.9, hp: 1, names: ['AA GUN'], w: 2.5, fires: 'guns', max: 8 },
  tank:      { cls: 'ground', glyph: 'tank', scale: 2.0, hp: 1, speed: 2, names: ['TANK'], w: 2, max: 8 },
  radar:     { cls: 'ground', glyph: 'radar', scale: 2.2, hp: 1, names: ['RADAR'], w: 0.8, max: 4 },
  frigate:   { cls: 'sea', glyph: 'ship', scale: 2.2, hp: 2, speed: 3, names: ['FRIGATE', 'CORVETTE'], w: 2, fires: 'missile', aa: true, max: 5 },
  destroyer: { cls: 'sea', glyph: 'ship', scale: 2.8, hp: 3, speed: 3, names: ['DESTROYER', 'CRUISER'], w: 1, fires: 'missile', aa: true, max: 3 }
};

const AA_MAX = 4;   // AA streams per beat (the tracer pool is a ring: more would cut live streams short)
const UNTOUCHED_MAX = 5;   // no new wave while this many enemies nobody has gone for yet are around (× density over 100%)
const ACE_P = 0.15, ACE_CALLSIGNS = ['SHADOW', 'RAVEN', 'SPECTRE', 'NOMAD', 'WRAITH', 'JACKAL', 'MANTIS', 'BANSHEE', 'COYOTE', 'HYDRA'];
const _e = new V3(), _r = new V3(), _q = new V3(), _b = new V3();
class EnemyForce extends Force {
  constructor() { super(ENEMY_TYPES, 'enemy'); this.waveT = 0; this.fireT = 3; this.missiles = 0; this.wasFighting = false; }
  get cap() { return Math.round(clamp(16 * CFG.density / 100, 0, 36)); }
  onGone(e) { for (const p of SQUAD.planes) if (p.target === e) SQUAD.release(p); }

  /* ---- waves ---- */
  wave() {
    const n0 = this.list.length, room = this.cap - this.alive; if (room <= 0) return 0;
    const heavy = AUD.heavy, k = this.near ? 0.75 : 1; this.near = false;
    _e.copy(ROUTE.pos).addScaledVector(ROUTE.fwd, rand(380, 620) * k).addScaledVector(ROUTE.right, rand(-260, 260));
    const land = TERRAIN.land(_e.x, _e.z), groundOk = land > 0.03, seaOk = land < -0.06;
    const airP = groundOk || seaOk ? 0.45 : 1;
    if (Math.random() < airP) this.airGroup(Math.min(room, randi(2, 3 + Math.round(heavy * 2))), k);
    else if (seaOk) this.seaGroup(_e, Math.min(room, randi(1, 3)), ['frigate', 'destroyer'], 70);
    else this.groundGroup(_e, Math.min(room, randi(3, 5 + Math.round(heavy * 2))), ['sam', 'aagun', 'tank', 'radar'], 45);
    return this.list.length - n0;
  }
  airGroup(n, k = 1) {
    const type = wpick(['fighter', 'bomber', 'attacker', 'heli'].map(k => ({ k, w: ENEMY_TYPES[k].w }))).k, ty = ENEMY_TYPES[type];
    const ahead = (type === 'heli' ? rand(300, 450) : rand(500, 750)) * k;
    _e.copy(ROUTE.pos).addScaledVector(ROUTE.fwd, ahead).addScaledVector(ROUTE.right, rand(-300, 300)); _e.y = TERRAIN.height(_e.x, _e.z) + rand(ty.alt[0], ty.alt[1]);
    // they come at the flight, roughly
    const toward = Math.atan2(ROUTE.pos.x - _e.x, ROUTE.pos.z - _e.z) + rand(-0.5, 0.5);
    _r.set(Math.cos(toward), 0, -Math.sin(toward)); _b.set(Math.sin(toward), 0, Math.cos(toward));
    // one type, one name for the whole group — or an ace squadron with its own callsign
    const ace = (type === 'fighter' || type === 'attacker') && Math.random() < ACE_P, name = ace ? pick(ACE_CALLSIGNS) : pick(ty.names);
    for (let i = 0; i < Math.min(n, type === 'bomber' ? 2 : 4); i++) {
      _q.copy(_e).addScaledVector(_r, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 12).addScaledVector(_b, -Math.ceil(i / 2) * 9);
      const s = this.spawn(type, _q, toward, ace ? `${name} ${i + 1}` : name); if (!s) continue;
      s.mode = type === 'heli' ? 'hover' : 'merge';
      if (ace) { s.ace = true; s.hp += 1; }
    }
  }

  update(dt) {
    const fighting = AUD.fighting;
    if (fighting && !this.wasFighting) { this.waveT = rand(4, 6); this.near = true; }   // first the flight spreads out, then the opening wave, a bit nearer
    this.wasFighting = fighting;
    if (fighting && CFG.density > 0) {
      this.waveT -= dt;
      const want = Math.max(3, Math.round(this.cap * (0.45 + AUD.heavy * 0.4)));
      // the next wave when this one is under way (not while most of it hasn't been touched yet)
      if (this.waveT <= 0 && this.alive < want && this.untouched() < UNTOUCHED_MAX * Math.max(1, CFG.density / 100)) { this.wave(); this.waveT = rand(5, 9) / Math.max(0.3, CFG.density / 100); }
    }
    if (fighting) this.fireT = Math.max(-1, this.fireT - dt);
    super.update(dt);   // after a fight SQUAD.startMopUp / endMopUp send the enemies into retreat
  }
  /* enemies nobody has gone for yet; aircraft that flew on past the fight (away from it, 300+ out) don't hold the next wave up */
  untouched() {
    let n = 0;
    for (const e of this.list) {
      if (!e.alive || e.hurt || e.chasers || e.incoming) continue;
      if (e.plane && _q.subVectors(e.pos, SQUAD.anchor).lengthSq() > 300 * 300 && _q.dot(e.plane.dir) > 0) continue;
      n++;
    }
    return n;
  }
  fly(e, dt) {
    const pl = e.plane;
    e.modeT -= dt;
    const tgt = this.nearestFriend(e.pos);
    if (e.state === 'retreat') { _q.subVectors(e.pos, ROUTE.pos).setY(0).normalize(); _q.y = 0.25; }   // turn away and climb
    else if (e.mode === 'hover') { _q.subVectors(ROUTE.pos, e.pos).setY(0); const d = _q.length(); _q.normalize(); if (d < 120) _q.applyAxisAngle(UP, 1.2); _q.y = (34 - pl.agl) * 0.05; }
    else if (e.type === 'bomber' || e.type === 'attacker') { _q.copy(pl.dir); _q.y = (e.ty.alt[0] + 20 - pl.agl) * 0.01; }
    else {   // fighters: merge, then dogfight with jinks
      if (e.mode === 'merge' && tgt && e.pos.distanceTo(tgt.pos) < 180) { e.mode = 'dogfight'; e.modeT = rand(3, 6); }
      if (e.mode === 'dogfight' && e.modeT <= 0) { e.modeT = e.ace ? rand(2.5, 5) : rand(4, 8); if (Math.random() < (e.ace ? 0.8 : 0.5)) tryManeuver(pl, ['breakTurn', 'barrel', 'splitS', 'immelmann']); }
      _q.subVectors(tgt ? tgt.pos : ROUTE.pos, e.pos).normalize();
      if (e.pos.distanceTo(ROUTE.pos) > 600) _q.subVectors(ROUTE.pos, e.pos).normalize();
    }
    this.steerAir(e, _q, dt, (e.mode === 'dogfight' ? 1.5 : 1) * (e.ace ? 1.3 : 1));
  }
  nearestFriend(p, maxD) { return nearestOf(SQUAD.planes, p, maxD); }
  /* ---- hostile fire (beats; never more often than every couple of seconds) ---- */
  onBeat(band) {
    if (!CFG.enemyFire) return;
    if (band === 'mid' && Math.random() < 0.5) {   // AA guns and ships' AA: streams that miss, from a few of them (random start)
      const L = this.list, k0 = randi(0, L.length - 1);
      for (let k = 0, shots = 0; k < L.length && shots < AA_MAX; k++) {
        const g = L[(k0 + k) % L.length];
        if (!g.alive || g.t < APPEAR_T || (g.ty.fires !== 'guns' && !g.ty.aa)) continue;   // a contact still appearing doesn't fire yet
        const f = this.nearestFriend(g.pos, 220); if (!f) continue;
        shots++;
        _q.set(g.pos.x, g.pos.y + (g.ty.cls === 'sea' ? 5 : 4), g.pos.z);
        _r.subVectors(f.pos, _q).normalize().add(_b.set(rand(-0.12, 0.12), rand(0.05, 0.15), rand(-0.12, 0.12))).normalize().multiplyScalar(90);
        for (let i = 0; i < 3; i++) TRACERS.spawn(_e.copy(_q).addScaledVector(_r, i * 0.03), _r, 2.2, true);
      }
    }
    if (band === 'low' || this.fireT > 0) return;
    // one shooter, aircraft weighted first (the dogfight keeps its missiles): a weighted pick in one pass, no arrays
    let s = null, ws = 0;
    for (const e of this.list) {
      if (!e.alive || e.t < APPEAR_T || e.ty.fires !== 'missile' || e.cd > 0 || !this.nearestFriend(e.pos, e.plane ? 200 : 300)) continue;
      const w = e.plane ? 3 : 1; ws += w; if (Math.random() * ws < w) s = e;
    }
    if (!s) return;
    const f = this.nearestFriend(s.pos, 300);
    if (s.plane) { _r.subVectors(f.pos, s.pos).normalize(); if (s.plane.dir.dot(_r) < 0.5) return; _q.copy(s.pos).addScaledVector(s.plane.dir, 2); _r.copy(s.plane.dir); }
    else { _q.set(s.pos.x, s.pos.y + (s.ty.cls === 'sea' ? 4 : 3), s.pos.z); _r.subVectors(f.pos, _q).normalize(); _r.y = Math.max(_r.y, 0.4); _r.normalize(); }
    if (!MISSILES.fire({ p: _q, d: _r, speed: s.plane ? s.plane.speed + 5 : 12, target: f, hit: false, enemy: true })) return;   // pool full: no launch, no threat
    GLOW.spawn(_q, { c: PAL.enemy, s: 3, life: 0.3 });
    SQUAD.threat(f);
    s.cd = s.ace ? rand(3, 5) : rand(5, 9); this.fireT = rand(2, 4.5); this.missiles++;
  }
}
const ENEMIES = new EnemyForce();

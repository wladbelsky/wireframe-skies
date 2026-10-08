'use strict';
/* ===== Allies: fleets, armour columns, fighter pairs, an AWACS — in peace and in a fight =====
   A group appears ahead of the flight every so often (CFG.allies): a fleet where the map ahead is sea, a column where
   it is land, or aircraft. They are passed and left behind (Force fades them at FAR_BEHIND). In a fight allied
   ships, SAMs and fighters fire at enemies on the beat — their missiles always hit. Allies are never targeted. */
const ALLY_TYPES = {
  aegis:     { cls: 'sea', glyph: 'ship', scale: 2.6, speed: 3, names: ['AEGIS'], w: 2, fires: 'missile', max: 6 },
  destroyer: { cls: 'sea', glyph: 'ship', scale: 2.3, speed: 3, names: ['DESTROYER'], w: 1.5, fires: 'missile', max: 4 },
  carrier:   { cls: 'sea', glyph: 'carrier', scale: 3.0, speed: 2.5, names: ['CARRIER'], w: 0, max: 1 },
  tank:      { cls: 'ground', glyph: 'tank', scale: 2.0, speed: 2.5, names: ['TANK'], w: 3, max: 8 },
  apc:       { cls: 'ground', glyph: 'tank', scale: 1.7, speed: 3, names: ['APC'], w: 2, max: 6 },
  sam:       { cls: 'ground', glyph: 'sam', scale: 2.2, names: ['SAM'], w: 0.8, fires: 'missile', max: 4 },
  hq:        { cls: 'ground', glyph: 'hq', scale: 2.4, names: ['HQ'], w: 0.3, max: 2 },
  fighter:   { cls: 'air', glyph: 'arrow', scale: 2.0, speed: 25, turn: 0.55, names: ['ALLY'], alt: [70, 140], fires: 'missile', max: 6 },
  awacs:     { cls: 'air', glyph: 'awacs', scale: 1.9, speed: 14, turn: 0.15, names: ['AWACS'], alt: [170, 200], max: 1 }
};
const ALLY_CALLSIGNS = ['VIPER', 'COBRA', 'LANCER', 'FALCON', 'HAWK', 'SABER', 'RAPIER', 'TALON'];
const ALLY_CAP = 14;

const _a = new V3(), _ad = new V3(), _ab = new V3();
class AllyForce extends Force {
  constructor() { super(ALLY_TYPES, 'ally'); this.groupT = rand(8, 20); this.fireT = 2; this.shots = 0; }
  update(dt) {
    this.groupT -= dt;
    if (this.groupT <= 0) { this.groupT = rand(35, 80) * (AUD.armed ? 0.6 : 1); if (CFG.allies && this.alive < ALLY_CAP - 3) this.group(); }
    if (AUD.fighting) this.fireT = Math.max(-1, this.fireT - dt);
    // allies switched off: the ones on the map fade out
    if (!CFG.allies) for (const e of this.list) if (e.state === 'live') this.vanish(e);
    super.update(dt);
  }
  group() {
    const room = ALLY_CAP - this.alive, h = ROUTE.heading + rand(-0.6, 0.6);
    _a.copy(ROUTE.pos).addScaledVector(ROUTE.fwd, rand(450, 700)).addScaledVector(ROUTE.right, rand(-220, 220));
    const land = TERRAIN.land(_a.x, _a.z), r = Math.random();
    if (r < 0.3 || (land > -0.06 && land < 0.03)) return this.airGroup(room);
    if (land <= -0.06) {
      const cv = Math.random() < 0.25 ? this.seaGroup(_a, 1, ['carrier'], 20, h) : 0;
      return cv + this.seaGroup(_a, Math.min(room - cv, randi(2, 4)), ['aegis', 'destroyer'], 75, h);
    }
    return this.groundGroup(_a, Math.min(room, randi(3, 6)), ['tank', 'apc', 'sam', 'hq'], 40, h);
  }
  airGroup(room) {
    if (Math.random() < 0.25) {   // an AWACS high above, slowly crossing
      _a.y = rand(170, 200); return this.spawn('awacs', _a, ROUTE.heading + rand(-1.2, 1.2)) ? 1 : 0;
    }
    const cs = pick(ALLY_CALLSIGNS), n = Math.min(room, Math.random() < 0.5 ? 2 : 4), h = ROUTE.heading + (Math.random() < 0.5 ? rand(-0.3, 0.3) : Math.PI + rand(-0.3, 0.3));
    _a.y = rand(70, 140); _ab.set(Math.cos(h), 0, -Math.sin(h));
    let made = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.ceil(i / 2);   // finger formation: 9 to the side, 7 back per pair
      _ad.copy(_a).addScaledVector(_ab, (i % 2 ? 1 : -1) * k * 9); _ad.x -= Math.sin(h) * k * 7; _ad.z -= Math.cos(h) * k * 7;
      if (this.spawn('fighter', _ad, h, `${cs} ${i + 1}`)) made++;
    }
    return made;
  }
  fly(e, dt) {
    const pl = e.plane; e.cd -= dt;
    if (e.type === 'fighter' && AUD.armed) {
      // in a fight: chase the nearest enemy aircraft near the battle area
      if (!e.target || !e.target.alive) e.target = ENEMIES.nearest(e.pos, 500, x => !!x.plane);
      if (e.target) { _a.copy(e.target.pos).addScaledVector(e.target.vel, 1).sub(e.pos).normalize(); return this.steerAir(e, _a, dt, 1.6); }
    }
    e.target = null;
    // cruise: hold the heading and the altitude band
    _a.set(Math.sin(e.heading), 0, Math.cos(e.heading)); _a.y = ((e.ty.alt[0] + e.ty.alt[1]) / 2 - e.pos.y) * 0.01;
    this.steerAir(e, _a, dt, 1);
  }
  /* in a fight: one allied missile per beat at most, from a ship / SAM / fighter with an enemy in range */
  onBeat(band) {
    if (band === 'low' || this.fireT > 0 || !CFG.allies) return;
    const cands = [];
    for (const s of this.list) {
      if (!s.alive || s.ty.fires !== 'missile' || s.cd > 0) continue;
      const t = ENEMIES.nearest(s.pos, s.plane ? 220 : 380, x => x.hp - x.incoming > 0 && (s.plane ? !!x.plane : true));
      if (t) cands.push([s, t]);
    }
    if (!cands.length) return;
    const [s, t] = pick(cands);
    if (s.plane) { _a.copy(s.pos).addScaledVector(s.plane.dir, 2); _ad.copy(s.plane.dir); }
    else { _a.set(s.pos.x, 3, s.pos.z); _ad.subVectors(t.pos, _a).normalize(); _ad.y = Math.max(_ad.y, 0.5); _ad.normalize(); }
    t.incoming++;
    MISSILES.fire({ p: _a, d: _ad, speed: s.plane ? s.plane.speed + 6 : 14, target: t, hit: true, c: PAL.ally, onHit: () => { t.incoming = Math.max(0, t.incoming - 1); ENEMIES.damage(t, 1); } });
    GLOW.spawn(_a, { c: PAL.ally, s: 3, life: 0.3 });
    s.cd = rand(5, 9); this.fireT = rand(1.5, 3); this.shots++;
  }
}
const ALLIES = new AllyForce();

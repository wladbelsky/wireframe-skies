'use strict';
/* ===== Camera =====
   'cinematic': a director picks a shot (azimuth relative to the flight's heading, elevation, distance, slow drift)
   and blends to the next one every CFG.shotLen s (±40 %). 'fixed': one shot from the properties.
   The focus is the flight's centroid, pulled toward the fight in combat; everything is smoothed, so maneuvers
   never jerk the view. CAM.right / CAM.upv are the screen axes (camera-facing crosses in LINES). */
const SHOTS = [
  { az: 180, el: 22, dist: 115, drift: 0 },     // chase
  { az: 140, el: 32, dist: 135, drift: 1.2 },   // rear quarter
  { az: 95, el: 14, dist: 120, drift: 0.5 },    // side
  { az: 165, el: 58, dist: 190, drift: 2.5 },   // high, orbiting
  { az: 30, el: 16, dist: 155, drift: -0.8 },   // ahead, they fly at the camera
  { az: 215, el: 30, dist: 220, drift: -1.5 },  // wide
  { az: 255, el: 44, dist: 165, drift: 1.8 }    // other side, from above
];
const _cf = new V3(), _ce = new V3(), _co = new V3(), _cs = new V3();
const CAM = {
  focus: new V3(), heading: 0, cur: { az: 180, el: 25, dist: 130 }, shot: SHOTS[1], shotT: 0, drift: 0, combatK: 0,
  right: new V3(1, 0, 0), upv: new V3(0, 1, 0), ready: false,
  hero: null, heroT: 0,   // in combat the camera follows one plane (a new one with each shot) and frames its target too
  nextShot() {
    const others = SHOTS.filter(s => s !== this.shot); this.shot = pick(others);
    this.shotT = CFG.shotLen * rand(0.6, 1.4) * (SQUAD.engaged ? 0.6 : 1); this.drift = 0;
    this.pickHero();
  },
  pickHero() {
    const busy = SQUAD.planes.filter(p => p.mode === 'engage' && p !== this.hero);
    this.hero = busy.length ? pick(busy) : pick(SQUAD.planes);
  },
  target() {
    if (CFG.camMode === 'fixed') return { az: CFG.fixedAz, el: CFG.fixedElev, dist: 150 };
    return { az: this.shot.az + this.drift, el: this.shot.el, dist: this.shot.dist };
  },
  update(dt) {
    // focus: the flight's centroid in peace; in combat the hero plane, pulled toward its target
    SQUAD.centroid(_cf);
    this.combatK += ((SQUAD.engaged ? 1 : 0) - this.combatK) * Math.min(1, dt * 0.5);
    if (!this.hero) this.pickHero();
    if (this.combatK > 0.001) {
      const h = this.hero; _ce.copy(h.pos);
      if (h.target && h.target.pos.distanceTo(h.pos) < 320) _ce.lerp(h.target.pos, 0.35);
      _cf.lerp(_ce, this.combatK);
    }
    if (!this.ready) { this.focus.copy(_cf); this.heading = ROUTE.heading; this.cur = Object.assign({}, this.target()); this.ready = true; }
    this.focus.lerp(_cf, 1 - Math.exp(-dt * 1.6));
    this.heading = approachAngle(this.heading, ROUTE.heading, Math.abs(angleWrap(ROUTE.heading - this.heading)) * dt * 0.4 + 0.0005);
    if (CFG.camMode !== 'fixed') { this.shotT -= dt; this.drift += this.shot.drift * dt; if (this.shotT <= 0) this.nextShot(); }
    else if ((this.heroT -= dt) <= 0) { this.heroT = rand(10, 18); this.pickHero(); }   // fixed: only the hero changes
    const tg = this.target(), k = 1 - Math.exp(-dt * 0.45);
    this.cur.az += angleWrap((tg.az - this.cur.az) * DEG) / DEG * k; this.cur.el = lerp(this.cur.el, tg.el, k); this.cur.dist = lerp(this.cur.dist, tg.dist, k);
    this.place();
  },
  place() {
    const dist = this.cur.dist * (100 / Math.max(10, CFG.zoom)) * (1 + this.combatK * 0.3);
    const th = this.heading + this.cur.az * DEG, el = clamp(this.cur.el, 3, 85) * DEG;
    _co.set(Math.sin(th) * Math.cos(el), Math.sin(el), Math.cos(th) * Math.cos(el)).multiplyScalar(dist);
    camera.position.copy(this.focus).add(_co); camera.position.y = Math.max(camera.position.y, 6);
    camera.lookAt(this.focus);
    camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(camera.matrixWorld, 0); this.upv.setFromMatrixColumn(camera.matrixWorld, 1);
  },
  distTo(p) { return camera.position.distanceTo(p); },
  /* is p in front of the camera and inside the frame, margin m (0..1 of the half-size) from the edges */
  onScreen(p, m) { _cs.copy(p).project(camera); return _cs.z < 1 && Math.abs(_cs.x) < 1 - (m || 0) && Math.abs(_cs.y) < 1 - (m || 0); },
  shift(dx, dz) { this.focus.x -= dx; this.focus.z -= dz; camera.position.x -= dx; camera.position.z -= dz; }
};

'use strict';
/* ===== Effects: trails, dynamic lines, glow points, bursts, missiles, gun tracers =====
   Every pool is allocated once and reused (the wallpaper never restarts); everything is additive line art. */

/* ---- Trail: the flown path behind an aircraft (newest point first, faded by index) ---- */
const TRAIL_DT = 0.1, TRAIL_MAX = 600;
class Trail {
  constructor(scene, color) {
    this.pos = new Float32Array(TRAIL_MAX * 3); this.col = new Float32Array(TRAIL_MAX * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.line.frustumCulled = false; this.line.renderOrder = 1;
    this.n = 0; this.acc = 0; this.color = new THREE.Color(color); this.len = -1; this.gain = 0.75;
    scene.add(this.line);
  }
  get max() { return Math.min(TRAIL_MAX, Math.round(CFG.trail / TRAIL_DT)); }
  recolor(color, gain) {
    if (color) this.color.copy(color); if (gain != null) this.gain = gain;
    const m = this.max; this.len = m;
    for (let i = 0; i < m; i++) { const f = Math.pow(1 - i / m, 1.6) * this.gain; this.col[i * 3] = this.color.r * f; this.col[i * 3 + 1] = this.color.g * f; this.col[i * 3 + 2] = this.color.b * f; }
    this.line.geometry.attributes.color.needsUpdate = true;
  }
  reset(p) { this.n = 1; this.acc = 0; this.pos[0] = p.x; this.pos[1] = p.y; this.pos[2] = p.z; this.sync(); }
  update(dt, p, visible) {
    const m = this.max; if (this.len !== m) this.recolor();
    this.line.visible = visible && m > 1;
    this.acc += dt;
    if (this.acc >= TRAIL_DT) { this.acc %= TRAIL_DT; this.pos.copyWithin(3, 0, (TRAIL_MAX - 1) * 3); this.n = Math.min(m, this.n + 1); }
    this.n = Math.min(this.n, m);
    this.pos[0] = p.x; this.pos[1] = p.y; this.pos[2] = p.z;   // the head follows the aircraft every step
    this.sync();
  }
  sync() { const g = this.line.geometry; g.attributes.position.needsUpdate = true; g.setDrawRange(0, this.n); }
  shift(dx, dz) { for (let i = 0; i < TRAIL_MAX * 3; i += 3) { this.pos[i] -= dx; this.pos[i + 2] -= dz; } }
}

/* ---- LINES: per-frame line segments (altitude lines, ground ticks, cross-outs, tracers, missile smoke) ---- */
const LINES = {
  cap: 3000, n: 0, mesh: null,
  build(scene) {
    this.pos = new Float32Array(this.cap * 6); this.col = new Float32Array(this.cap * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
  },
  begin() { this.n = 0; },
  /* a → b, colour c scaled by a0 at a and a1 at b */
  add(ax, ay, az, bx, by, bz, c, a0, a1) {
    if (this.n >= this.cap) return;
    const i = this.n++ * 6, P = this.pos, C = this.col; if (a1 == null) a1 = a0;
    P[i] = ax; P[i + 1] = ay; P[i + 2] = az; P[i + 3] = bx; P[i + 4] = by; P[i + 5] = bz;
    C[i] = c.r * a0; C[i + 1] = c.g * a0; C[i + 2] = c.b * a0; C[i + 3] = c.r * a1; C[i + 4] = c.g * a1; C[i + 5] = c.b * a1;
  },
  addV(a, b, c, a0, a1) { this.add(a.x, a.y, a.z, b.x, b.y, b.z, c, a0, a1); },
  /* altitude line from p down to the ground with a small cross there */
  drop(p, c, a) {
    this.add(p.x, p.y, p.z, p.x, 0, p.z, c, a * 0.55, a * 0.25);
    const s = 1.6; this.add(p.x - s, 0, p.z, p.x + s, 0, p.z, c, a * 0.6); this.add(p.x, 0, p.z - s, p.x, 0, p.z + s, c, a * 0.6);
  },
  /* a camera-facing X of size r around p */
  cross(p, r, c, a) {
    const R = CAM.right, U = CAM.upv;
    this.add(p.x + (-R.x - U.x) * r, p.y + (-R.y - U.y) * r, p.z + (-R.z - U.z) * r, p.x + (R.x + U.x) * r, p.y + (R.y + U.y) * r, p.z + (R.z + U.z) * r, c, a);
    this.add(p.x + (-R.x + U.x) * r, p.y + (-R.y + U.y) * r, p.z + (-R.z + U.z) * r, p.x + (R.x - U.x) * r, p.y + (R.y - U.y) * r, p.z + (R.z - U.z) * r, c, a);
  },
  end() {
    const g = this.mesh.geometry; g.setDrawRange(0, this.n * 2);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
};

/* ---- GLOW: additive glow points — transient particles (sparks, flares) plus per-frame dots (missile heads) ---- */
const GLOW = {
  cap: 900, n: 0, parts: [], pi: 0, PARTS: 500,
  build(scene) {
    this.pos = new Float32Array(this.cap * 3); this.col = new Float32Array(this.cap * 3); this.size = new Float32Array(this.cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uTex: { value: TEX.glow }, uScale: { value: 500 } };
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = color; gl_PointSize = clamp(size * uScale / -mv.z, 1.5, 64.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying vec3 vC; void main(){ gl_FragColor = vec4(vC * texture2D(uTex, gl_PointCoord).r, 1.0); }` });
    this.mesh = new THREE.Points(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; scene.add(this.mesh);
    for (let i = 0; i < this.PARTS; i++) this.parts.push({ life: 0, age: 1, p: new V3(), v: new V3(), c: new THREE.Color(), s: 1, drag: 0, grav: 0 });
  },
  /* a particle (ring buffer: the oldest is overwritten) */
  spawn(p, o) {
    const q = this.parts[this.pi]; this.pi = (this.pi + 1) % this.PARTS;
    q.p.copy(p); q.v.copy(o.v || UP).multiplyScalar(o.v ? 1 : 0); q.c.copy(o.c || PAL.white); q.s = o.s || 1; q.life = o.life || 1; q.age = 0;
    q.drag = o.drag || 0; q.grav = o.grav || 0; q.a = o.a == null ? 1 : o.a;
  },
  begin() { this.n = 0; },
  dot(p, s, c, a) {
    if (this.n >= this.cap) return;
    const i = this.n++; this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.col[i * 3] = c.r * a; this.col[i * 3 + 1] = c.g * a; this.col[i * 3 + 2] = c.b * a; this.size[i] = s;
  },
  update(dt) {
    for (const q of this.parts) {
      if (q.age >= q.life) continue;
      q.age += dt; q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.v.y -= q.grav * dt; q.p.addScaledVector(q.v, dt);
    }
  },
  drawParts() { for (const q of this.parts) if (q.age < q.life) this.dot(q.p, q.s, q.c, q.a * (1 - q.age / q.life)); },
  live() { let k = 0; for (const q of this.parts) if (q.age < q.life) k++; return k; },
  end(camera, height) {
    this.uniforms.uScale.value = height / (2 * Math.tan(camera.fov * DEG / 2));
    const g = this.mesh.geometry; g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  },
  shift(dx, dz) { for (const q of this.parts) { q.p.x -= dx; q.p.z -= dz; } }
};

/* ---- BURSTS: expanding wire spheres (air) / ground rings + sparks; one material per slot for the fade ---- */
const BURST_GEO = {};
const BURSTS = {
  pool: [], N: 18,
  build(scene) {
    BURST_GEO.sphere = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1));
    BURST_GEO.ring = new Seg().ring(0, 0, 0, 1, 28, 'y').geometry();
    for (let i = 0; i < this.N; i++) {
      const m = lineMaterial(0xffffff, 0), g = new THREE.Group();
      g.add(new THREE.LineSegments(BURST_GEO.sphere, m), new THREE.LineSegments(BURST_GEO.ring, m));
      g.visible = false; scene.add(g);
      this.pool.push({ g, m, t: 1, life: 1, r: 1, ground: false });
    }
  },
  spawn(p, color, r, ground) {
    let b = this.pool.find(x => x.t >= x.life) || this.pool.reduce((a, x) => (x.t / x.life > a.t / a.life ? x : a));
    b.t = 0; b.life = ground ? 1.6 : 1.1; b.r = r; b.ground = ground;
    b.g.position.copy(p); b.m.color.copy(color); b.g.visible = true;
    b.g.children[0].visible = true; b.g.children[1].visible = ground;
    b.g.children[1].position.y = -p.y + 0.2;
    const n = Math.round(10 + r * 2);
    for (let i = 0; i < n; i++) GLOW.spawn(p, { v: new V3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14) * r / 3), c: i % 3 ? PAL.flare : color, s: rand(0.7, 1.5), a: 0.8, life: rand(0.5, 1.3), drag: 1.5, grav: ground ? 6 : 2 });
    GLOW.spawn(p, { c: PAL.white, s: r * 3, life: 0.3 });
  },
  update(dt) {
    for (const b of this.pool) {
      if (b.t >= b.life) { b.g.visible = false; continue; }
      b.t += dt; const u = Math.min(1, b.t / b.life), e = 1 - Math.pow(1 - u, 3);
      b.g.children[0].scale.setScalar(b.r * (0.3 + e * 1.4)); b.g.children[0].rotation.y += dt * 0.8;
      b.g.children[1].scale.setScalar(b.r * (0.5 + e * 3));
      b.m.opacity = (1 - u) * 0.9;
    }
  },
  shift(dx, dz) { for (const b of this.pool) { b.g.position.x -= dx; b.g.position.z -= dz; } }
};

/* ---- MISSILES: pooled; friendly ones always reach a live target, hostile ones always lose lock ----
   Each keeps a short smoke history drawn through LINES. */
const MSL_HIST = 14, MSL_HDT = 0.06;
const _mv = new V3(), _mt = new V3();
const MISSILES = {
  pool: [], N: 60,
  build() { for (let i = 0; i < this.N; i++) this.pool.push({ on: false, p: new V3(), d: new V3(), speed: 0, age: 0, hist: new Float32Array(MSL_HIST * 3), hn: 0, hacc: 0, target: null, hit: false, onHit: null, enemy: false, lock: 0, dying: 0 }); },
  get live() { let k = 0; for (const m of this.pool) if (m.on || m.dying > 0) k++; return k; },
  /* o: { p, d (unit), speed, target ({ pos, alive }), hit: true/false, onHit(m), enemy } */
  fire(o) {
    const m = this.pool.find(x => !x.on && x.dying <= 0); if (!m) return null;
    m.on = true; m.p.copy(o.p); m.d.copy(o.d).normalize(); m.speed = o.speed || 30; m.age = 0; m.target = o.target; m.hit = !!o.hit;
    m.onHit = o.onHit || null; m.enemy = !!o.enemy; m.lock = o.hit ? 99 : rand(1.2, 2.2); m.hn = 1; m.hacc = 0; m.dying = 0;
    m.hist[0] = m.p.x; m.hist[1] = m.p.y; m.hist[2] = m.p.z; m.maxSpeed = o.enemy ? 52 : 68; m.turn = o.enemy ? 1.6 : 3.2;
    return m;
  },
  update(dt) {
    for (const m of this.pool) {
      if (!m.on) { if (m.dying > 0) m.dying -= dt; continue; }
      m.age += dt; m.speed = Math.min(m.maxSpeed, m.speed + 45 * dt);
      const t = m.target, homing = t && t.alive && m.age < m.lock;
      if (homing) {
        _mt.copy(t.pos); if (t.vel) _mt.addScaledVector(t.vel, Math.min(1.2, m.p.distanceTo(t.pos) / m.speed) * 0.8);
        _mv.subVectors(_mt, m.p); const dist = _mv.length();
        if (m.hit && dist < Math.max(2.5, m.speed * dt * 1.5)) { this.detonate(m, true); continue; }
        _mv.normalize(); const ang = Math.acos(clamp(m.d.dot(_mv), -1, 1)), turn = m.turn * (m.hit ? 1 + m.age : 1);
        if (ang > 1e-4) { m.d.lerp(_mv, Math.min(1, turn * dt / ang)).normalize(); }
        if (m.hit && m.age > 8) { this.detonate(m, true); continue; }   // never fly forever: it got there
      } else if (m.lock > m.age) { m.hit = false; m.lock = m.age; }   // target gone: fly on briefly, then self-destruct
      if (!m.hit && m.age > m.lock + 2.5) { this.detonate(m, false); continue; }
      if (m.p.y < 1) { this.detonate(m, false); continue; }
      m.p.addScaledVector(m.d, m.speed * dt);
      m.hacc += dt;
      if (m.hacc >= MSL_HDT) { m.hacc %= MSL_HDT; m.hist.copyWithin(3, 0, (MSL_HIST - 1) * 3); m.hn = Math.min(MSL_HIST, m.hn + 1); }
      m.hist[0] = m.p.x; m.hist[1] = m.p.y; m.hist[2] = m.p.z;
    }
  },
  /* per frame (after the sim steps): smoke trails into LINES, heads into GLOW */
  draw() {
    for (const m of this.pool) {
      if (m.on) { this.drawTrail(m, 1); GLOW.dot(m.p, 1.4, m.enemy ? PAL.enemy : PAL.missile, 1); }
      else if (m.dying > 0) this.drawTrail(m, m.dying / 0.8);
    }
  },
  drawTrail(m, a) {
    const c = m.enemy ? PAL.enemy : PAL.missile, h = m.hist;
    for (let i = 0; i < m.hn - 1; i++) LINES.add(h[i * 3], h[i * 3 + 1], h[i * 3 + 2], h[i * 3 + 3], h[i * 3 + 4], h[i * 3 + 5], c, a * 0.7 * (1 - i / MSL_HIST), a * 0.7 * (1 - (i + 1) / MSL_HIST));
  },
  detonate(m, onTarget) {
    m.on = false; m.dying = 0.8;
    if (onTarget && m.onHit) m.onHit(m);
    else BURSTS.spawn(m.p, m.enemy ? PAL.enemy : PAL.missile, 1.2, false);
  },
  clear() { for (const m of this.pool) { m.on = false; m.dying = 0; } },
  shift(dx, dz) { for (const m of this.pool) { m.p.x -= dx; m.p.z -= dz; for (let i = 0; i < MSL_HIST * 3; i += 3) { m.hist[i] -= dx; m.hist[i + 2] -= dz; } } }
};

/* ---- TRACERS: gun bursts (short streaks) ---- */
const TRACERS = {
  pool: [], N: 160, i: 0,
  build() { for (let k = 0; k < this.N; k++) this.pool.push({ p: new V3(), v: new V3(), life: 0, enemy: false }); },
  spawn(p, v, life, enemy) { const t = this.pool[this.i]; this.i = (this.i + 1) % this.N; t.p.copy(p); t.v.copy(v); t.life = life; t.enemy = enemy; },
  update(dt) {
    for (const t of this.pool) {
      if (t.life <= 0) continue;
      t.life -= dt; t.p.addScaledVector(t.v, dt);
    }
  },
  draw() {
    for (const t of this.pool) {
      if (t.life <= 0) continue;
      LINES.add(t.p.x, t.p.y, t.p.z, t.p.x - t.v.x * 0.035, t.p.y - t.v.y * 0.035, t.p.z - t.v.z * 0.035, t.enemy ? PAL.enemy : PAL.flare, 0.9, 0.1);
    }
  },
  shift(dx, dz) { for (const t of this.pool) { t.p.x -= dx; t.p.z -= dz; } }
};

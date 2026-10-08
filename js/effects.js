'use strict';
/* ===== Effects: trails, dynamic lines, glow points, bursts, missiles, gun tracers =====
   Every pool is allocated once and reused (the wallpaper never restarts); everything is additive line art.
   Simulation (update) and drawing (draw → LINES / GLOW, once per frame) are separate. */

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

/* ---- LINES: per-frame glowing line segments (glyphs, altitude lines, poles, cross-outs, tracers, missile smoke) ----
   One instanced draw call: every segment is a screen-space quad of a constant pixel width with a soft halo, so lines
   look the same at any distance (like the replay screen). Endpoints behind the camera are clipped to the near plane. */
const LINE_W = 1.6;   // default core width, CSS px
const LINES = {
  cap: 4000, n: 0, mesh: null,
  build(scene) {
    const N = this.cap, g = new THREE.InstancedBufferGeometry();
    // base quad: x = t along the segment (0..1), y = s across it (-1..1)
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    const at = (k, n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(N * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); return a.array; };
    this.A = at('iA', 3); this.B = at('iB', 3); this.CA = at('iCA', 3); this.CB = at('iCB', 3); this.W = at('iW', 1);
    g.instanceCount = 0;
    this.uniforms = { uRes: { value: new THREE.Vector2(1, 1) }, uPR: { value: 1 } };
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 iA, iB, iCA, iCB; attribute float iW; uniform vec2 uRes; uniform float uPR;
        varying vec3 vC; varying float vS, vH, vR;
        void main(){
          mat4 pv = projectionMatrix * viewMatrix;
          vec4 a = pv * vec4(iA, 1.0), b = pv * vec4(iB, 1.0);
          const float NW = 0.05;
          if (a.w < NW && b.w < NW) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          if (a.w < NW) a = mix(a, b, (NW - a.w) / (b.w - a.w));
          if (b.w < NW) b = mix(b, a, (NW - b.w) / (a.w - b.w));
          vec2 sa = a.xy / a.w * uRes, sb = b.xy / b.w * uRes, d = sb - sa;
          d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
          vec2 n = vec2(-d.y, d.x);
          float hw = iW * uPR * 0.5, R = hw + (3.0 + iW * 2.0) * uPR;          // core half width + halo, device px
          vec4 p = mix(a, b, position.x);
          vec2 off = n * position.y * R + d * (position.x * 2.0 - 1.0) * hw;
          p.xy += off / uRes * p.w;
          vC = mix(iCA, iCB, position.x); vS = position.y * R; vH = hw; vR = R;
          gl_Position = p;
        }`,
      fragmentShader: `
        varying vec3 vC; varying float vS, vH, vR;
        void main(){
          float d = abs(vS);
          float core = 1.0 - smoothstep(vH - 0.6, vH + 0.6, d);
          float halo = 1.0 - smoothstep(vH, vR, d); halo *= halo * 0.45;
          gl_FragColor = vec4(vC * (core + halo), 1.0);
        }`
    });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
  },
  begin() { this.n = 0; },
  /* a → b, colour c scaled by a0 at a and a1 at b, core width w (CSS px) */
  add(ax, ay, az, bx, by, bz, c, a0, a1, w) {
    if (this.n >= this.cap) return;
    const i = this.n++, j = i * 3; if (a1 == null) a1 = a0;
    this.A[j] = ax; this.A[j + 1] = ay; this.A[j + 2] = az; this.B[j] = bx; this.B[j + 1] = by; this.B[j + 2] = bz;
    this.CA[j] = c.r * a0; this.CA[j + 1] = c.g * a0; this.CA[j + 2] = c.b * a0; this.CB[j] = c.r * a1; this.CB[j + 1] = c.g * a1; this.CB[j + 2] = c.b * a1;
    this.W[i] = w || LINE_W;
  },
  /* altitude line from p down to the ground with a small cross there */
  drop(p, c, a, w) {
    this.add(p.x, p.y, p.z, p.x, 0, p.z, c, a * 0.8, a * 0.35, w || 2.2);
    const s = 1.4; this.add(p.x - s, 0, p.z, p.x + s, 0, p.z, c, a * 0.6, a * 0.6, 1.4); this.add(p.x, 0, p.z - s, p.x, 0, p.z + s, c, a * 0.6, a * 0.6, 1.4);
  },
  /* a camera-facing X of size r around p */
  cross(p, r, c, a, w) {
    const R = CAM.right, U = CAM.upv; w = w || 2.6;
    this.add(p.x + (-R.x - U.x) * r, p.y + (-R.y - U.y) * r, p.z + (-R.z - U.z) * r, p.x + (R.x + U.x) * r, p.y + (R.y + U.y) * r, p.z + (R.z + U.z) * r, c, a, a, w);
    this.add(p.x + (-R.x + U.x) * r, p.y + (-R.y + U.y) * r, p.z + (-R.z + U.z) * r, p.x + (R.x - U.x) * r, p.y + (R.y - U.y) * r, p.z + (R.z - U.z) * r, c, a, a, w);
  },
  /* a circle of radius r around p: camera-facing, or lying flat (on the ground plane) */
  circle(p, r, c, a, flat, w, n) {
    n = n || 20; const R = flat ? _cx.set(1, 0, 0) : CAM.right, U = flat ? _cz.set(0, 0, 1) : CAM.upv;
    let px = p.x + R.x * r, py = p.y + R.y * r, pz = p.z + R.z * r;
    for (let i = 1; i <= n; i++) {
      const t = i / n * TAU, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
      const x = p.x + R.x * cs + U.x * sn, y = p.y + R.y * cs + U.y * sn, z = p.z + R.z * cs + U.z * sn;
      this.add(px, py, pz, x, y, z, c, a, a, w); px = x; py = y; pz = z;
    }
  },
  /* after the frame's adds: upload what was written; width / height in device px */
  end(width, height, pr) {
    const g = this.mesh.geometry; g.instanceCount = this.n;
    this.uniforms.uRes.value.set(width / 2, height / 2); this.uniforms.uPR.value = pr;
    for (const k of ['iA', 'iB', 'iCA', 'iCB', 'iW']) { const at = g.attributes[k]; at.needsUpdate = true; at.updateRange.offset = 0; at.updateRange.count = Math.max(1, this.n) * at.itemSize; }
  }
};
const _cx = new V3(), _cz = new V3();

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
  end(camera, height) {
    this.uniforms.uScale.value = height / (2 * Math.tan(camera.fov * DEG / 2));
    const g = this.mesh.geometry; g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  },
  shift(dx, dz) { for (const q of this.parts) { q.p.x -= dx; q.p.z -= dz; } }
};

/* ---- BURSTS: expanding circles (camera-facing in the air, flat on the ground) + sparks, drawn through LINES ---- */
const BURSTS = {
  pool: [], N: 24,
  build() { for (let i = 0; i < this.N; i++) this.pool.push({ p: new V3(), c: new THREE.Color(), t: 1, life: 1, r: 1, ground: false }); },
  spawn(p, color, r, ground) {
    const b = this.pool.find(x => x.t >= x.life) || this.pool.reduce((a, x) => (x.t / x.life > a.t / a.life ? x : a));
    b.t = 0; b.life = ground ? 1.6 : 1.1; b.r = r; b.ground = ground; b.p.copy(p); b.c.copy(color);
    const n = Math.round(8 + r * 2);
    for (let i = 0; i < n; i++) GLOW.spawn(p, { v: new V3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 14) * r / 3), c: i % 3 ? PAL.flare : color, s: rand(0.6, 1.3), a: 0.8, life: rand(0.4, 1.1), drag: 1.5, grav: ground ? 6 : 2 });
    GLOW.spawn(p, { c: PAL.white, s: r * 2.6, life: 0.3 });
  },
  update(dt) { for (const b of this.pool) if (b.t < b.life) b.t += dt; },
  draw() {
    for (const b of this.pool) {
      if (b.t >= b.life) continue;
      const u = Math.min(1, b.t / b.life), e = 1 - Math.pow(1 - u, 3), a = (1 - u) * 0.9;
      LINES.circle(b.p, b.r * (0.4 + e * 1.6), b.c, a, false, 2, 18);
      if (b.r > 2) LINES.circle(b.p, b.r * (0.2 + e * 0.9), b.c, a * 0.6, false, 1.4, 14);
      if (b.ground) LINES.circle(_bg.set(b.p.x, 0.2, b.p.z), b.r * (0.6 + e * 3), b.c, a * 0.8, true, 1.6, 24);
    }
  },
  shift(dx, dz) { for (const b of this.pool) { b.p.x -= dx; b.p.z -= dz; } }
};
const _bg = new V3();

/* ---- MISSILES: pooled; friendly ones always reach a live target, hostile ones always lose lock ----
   Each keeps a short smoke history drawn through LINES. */
const MSL_HIST = 14, MSL_HDT = 0.06;
const _mv = new V3(), _mt = new V3();
const MISSILES = {
  pool: [], N: 60,
  build() { for (let i = 0; i < this.N; i++) this.pool.push({ on: false, p: new V3(), d: new V3(), speed: 0, age: 0, hist: new Float32Array(MSL_HIST * 3), hn: 0, hacc: 0, target: null, hit: false, onHit: null, enemy: false, c: PAL.missile, lock: 0, dying: 0 }); },
  get live() { let k = 0; for (const m of this.pool) if (m.on || m.dying > 0) k++; return k; },
  /* o: { p, d (unit), speed, target ({ pos, alive, gen? }), hit: true/false, onHit(m), enemy, c (colour) }; null when the pool is full.
     A pooled target (enemy slot) carries gen: the missile follows only that spawn, not whatever reuses the slot later. */
  fire(o) {
    const m = this.pool.find(x => !x.on && x.dying <= 0); if (!m) return null;
    m.on = true; m.p.copy(o.p); m.d.copy(o.d).normalize(); m.speed = o.speed || 30; m.age = 0; m.target = o.target; m.hit = !!o.hit;
    m.onHit = o.onHit || null; m.gen = o.target ? o.target.gen : undefined; m.enemy = !!o.enemy; m.c = o.c || (o.enemy ? PAL.enemy : PAL.missile); m.lock = o.hit ? 99 : rand(1.2, 2.2); m.hn = 1; m.hacc = 0; m.dying = 0;
    m.hist[0] = m.p.x; m.hist[1] = m.p.y; m.hist[2] = m.p.z; m.maxSpeed = o.enemy ? 52 : 68; m.turn = o.enemy ? 1.6 : 3.2;
    return m;
  },
  update(dt) {
    for (const m of this.pool) {
      if (!m.on) { if (m.dying > 0) m.dying -= dt; continue; }
      m.age += dt; m.speed = Math.min(m.maxSpeed, m.speed + 45 * dt);
      const t = m.target, homing = t && t.alive && t.gen === m.gen && m.age < m.lock;
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
      if (m.on) { this.drawTrail(m, 1); GLOW.dot(m.p, 1.4, m.c, 1); }
      else if (m.dying > 0) this.drawTrail(m, m.dying / 0.8);
    }
  },
  drawTrail(m, a) {
    const c = m.c, h = m.hist;
    for (let i = 0; i < m.hn - 1; i++) LINES.add(h[i * 3], h[i * 3 + 1], h[i * 3 + 2], h[i * 3 + 3], h[i * 3 + 4], h[i * 3 + 5], c, a * 0.7 * (1 - i / MSL_HIST), a * 0.7 * (1 - (i + 1) / MSL_HIST), 1.3);
  },
  detonate(m, onTarget) {
    m.on = false; m.dying = 0.8;
    if (onTarget && m.onHit) m.onHit(m);
    else BURSTS.spawn(m.p, m.c, 1.2, false);
  },
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
      LINES.add(t.p.x, t.p.y, t.p.z, t.p.x - t.v.x * 0.035, t.p.y - t.v.y * 0.035, t.p.z - t.v.z * 0.035, t.enemy ? PAL.enemy : PAL.flare, 0.9, 0.1, 1.3);
    }
  },
  shift(dx, dz) { for (const t of this.pool) { t.p.x -= dx; t.p.z -= dz; } }
};

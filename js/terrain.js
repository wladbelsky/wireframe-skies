'use strict';
/* ===== World origin, terrain fields, ground shader =====
   The ground is a flat map at y = 0, drawn entirely in a fragment shader: grid, sea dots, coastline, contour lines,
   city blocks — the look of the Ace Combat replay screen. Nothing is generated per chunk: the fields are functions of
   the world position (js/noise.js), so the landscape changes as the flight moves and never repeats noticeably. */

/* ---- floating origin: local coordinates stay small however long the wallpaper runs ----
   world = local + WORLD.origin. WORLD.recenter() moves the origin to the flight when it strays > RECENTER units and
   tells every registered system to shift its local positions by (-dx, -dz). */
const RECENTER = 1500;
const WORLD = { origin: { x: 0, z: 0 }, shifts: 0, handlers: [],
  onShift(fn) { this.handlers.push(fn); },
  recenter(cx, cz) {
    if (Math.abs(cx) < RECENTER && Math.abs(cz) < RECENTER) return false;
    const dx = Math.round(cx), dz = Math.round(cz);
    this.origin.x += dx; this.origin.z += dz; this.shifts++;
    for (const fn of this.handlers) fn(dx, dz);
    return true;
  },
  wx(x) { return wrapP(x + this.origin.x); }, wz(z) { return wrapP(z + this.origin.z); }
};

const TERRAIN = {
  /* fields at a local position */
  land(x, z) { return landField(WORLD.wx(x), WORLD.wz(z)); },
  sample(x, z, out) {
    const wx = WORLD.wx(x), wz = WORLD.wz(z), land = landField(wx, wz);
    out = out || {}; out.land = land; out.relief = reliefField(wx, wz, land); out.city = cityField(wx, wz, land); out.mount = mountField(wx, wz);
    return out;
  },
  isSea(x, z) { return this.land(x, z) < -0.04; },
  isLand(x, z) { return this.land(x, z) > 0.02; },
  mesh: null, uniforms: null,
  build(scene) {
    this.uniforms = {
      uOrigin: { value: new THREE.Vector2() }, uCam: { value: new V3() },
      uGrid: { value: PAL.grid }, uLand: { value: PAL.land }, uBg: { value: PAL.bg },
      uFog: { value: new THREE.Vector2(700, 2600) }, uDebug: { value: 0 }
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthWrite: false, extensions: { derivatives: true },
      vertexShader: `
        varying vec2 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: NOISE_GLSL + `
        varying vec2 vW; uniform vec3 uCam;
        uniform vec2 uOrigin; uniform vec3 uGrid, uLand, uBg; uniform vec2 uFog; uniform float uDebug;
        float lineAA(float v, float w){ float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4); return 1.0 - clamp(d - w, 0.0, 1.0); }
        void main(){
          vec2 p = vW + uOrigin;
          float land = landField(p);
          if (uDebug > 0.5 && uDebug < 1.5) { gl_FragColor = vec4(vec3(land > 0.0 ? 1.0 : 0.0), 1.0); return; }
          float relief = reliefField(p, land), city = cityField(p, land);
          float px = length(fwidth(p));                                   // world units per pixel
          // grid: minor every 40, major every 200 units; fades out where it would alias
          float gMin = max(lineAA(p.x / 40.0, 0.2), lineAA(p.y / 40.0, 0.2)) * (1.0 - smoothstep(0.08, 0.3, px / 40.0));
          float gMaj = max(lineAA(p.x / 200.0, 0.45), lineAA(p.y / 200.0, 0.45)) * (1.0 - smoothstep(0.08, 0.3, px / 200.0));
          vec3 col = uGrid * max(gMin * 0.38, gMaj * 0.7);
          // (no derivatives inside branches: every term is computed, then masked)
          // sea: sparse dots
          vec2 q = (fract(p / 16.0) - 0.5) * 16.0;
          float dt = (1.0 - smoothstep(0.6, 1.4, length(q) / max(px, 1e-3))) * (1.0 - smoothstep(0.1, 0.25, px / 16.0));
          col += uGrid * dt * 0.9 * clamp(-land * 25.0, 0.0, 1.0);
          // coastline
          float coast = 1.0 - clamp(abs(land) / max(fwidth(land), 1e-5) - 0.6, 0.0, 1.0);
          col += uLand * coast * 0.95;
          // contour lines on land, every fifth one brighter; faded where they crowd
          float k = relief * 14.0, idx = mod(floor(k + 0.5), 5.0);
          float c = lineAA(k, 0.15) * (1.0 - smoothstep(0.25, 0.6, fwidth(k))) * step(0.0, land);
          col += uLand * c * (idx < 0.5 ? 0.6 : 0.3);
          // city blocks: random filled lots on an 8-unit lattice
          vec2 cp = p / 8.0, ci = floor(cp), cf = fract(cp);
          float h = hashU(mod(ci.x, 8192.0), mod(ci.y, 8192.0), 11.0);
          vec2 blk = mod(ci, 6.0);                                         // a street every sixth lot
          float lot = step(h, city * 0.5) * step(0.5, blk.x) * step(0.5, blk.y) * step(0.18, cf.x) * step(cf.x, 0.82 - h * 0.3) * step(0.15, cf.y) * step(cf.y, 0.85);
          col += uLand * lot * (0.12 + h * 0.3) * (1.0 - smoothstep(0.15, 0.5, px / 8.0));
          float fog = 1.0 - smoothstep(uFog.x, uFog.y, distance(vec3(vW.x, 0.0, vW.y), uCam));   // per pixel: the quad is huge
          gl_FragColor = vec4(uBg + col * fog, 1.0);
          if (uDebug > 1.5) gl_FragColor = vec4(gMin, px, fog, 1.0);
        }`
    });
    const geo = new THREE.PlaneGeometry(9000, 9000); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  },
  /* every frame: the plane follows the camera's focus, the shader gets the wrapped origin */
  update(cam, focus) {
    this.mesh.position.set(focus.x, 0, focus.z);
    this.uniforms.uOrigin.value.set(wrapP(WORLD.origin.x), wrapP(WORLD.origin.z));
    this.uniforms.uCam.value.copy(cam.position);
    const far = Math.max(1800, cam.position.y * 4 + 1200); this.uniforms.uFog.value.set(far * 0.3, far);
  }
};

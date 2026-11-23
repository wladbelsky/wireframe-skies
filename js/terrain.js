'use strict';
/* ===== World origin, terrain fields, ground shader (a TSL node material) =====
   The ground is a grid mesh that follows the camera, lifted by the terrain height in its vertex shader (sea = 0,
   mountains up to ~100) and drawn entirely in a fragment shader: grid, sea dots, coastline, contour lines (one per
   1/14 of relief, ~1.9 units of height), city blocks — the look of the replay screen. Nothing is generated per chunk: the fields are
   functions of the world position (js/noise.js), so the landscape changes as the flight moves and never repeats.
   The mesh snaps to whole GROUND_STEP cells of the world, so its vertices always sample the same world points (no
   swimming); TERRAIN.height (JS) is the same function, so units stand and aircraft fly on what is drawn. */
const GROUND_STEP = 32, GROUND_CELLS = 240;   // vertex spacing (divides NOISE_P), cells per side (7680 units)
/* brightness of the map's layers. The map is composed in display space (sRGB, anti-aliased coverage included) and
   converted to linear once at the end, so it looks exactly as it was tuned on screen (colour management is on) */
const GROUND_K = { minor: 0.38, major: 0.7, dots: 0.9, coast: 0.95, contour5: 0.6, contour: 0.3 };

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
  /* ground height at a local position (0 at sea) */
  height(x, z) { const wx = WORLD.wx(x), wz = WORLD.wz(z); return heightField(wx, wz, landField(wx, wz)); },
  isSea(x, z) { return this.land(x, z) < -0.04; },
  isLand(x, z) { return this.land(x, z) > 0.02; },
  mesh: null, uniforms: null,
  build(scene) {
    const { Fn, uniform, float, vec2, vec3, vec4, positionGeometry, positionWorld, modelWorldMatrix, abs, fract, fwidth, max, clamp,
      smoothstep, step, floor, length, distance, mod, select, sRGBTransferEOTF } = THREE.TSL;
    const N = NOISE_TSL;
    const U = this.uniforms = {
      uOrigin: uniform(new THREE.Vector2()), uCam: uniform(new V3()),
      uGrid: uniform(new THREE.Color()), uLand: uniform(new THREE.Color()), uBg: uniform(new THREE.Color()),   // sRGB (update)
      uFog: uniform(new THREE.Vector2(700, 2600)), uDebug: uniform(0)
    };
    const mat = new THREE.MeshBasicNodeMaterial({ fog: false });
    // vertex: lifted by the terrain height at its world point (debug views stay flat: land / sea mask tests)
    mat.positionNode = Fn(() => {
      const p = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xz.add(U.uOrigin);
      return vec3(positionGeometry.x, select(U.uDebug.lessThan(0.5), N.heightField(p, N.landField(p)), positionGeometry.y), positionGeometry.z);
    })();
    // fragment: the map. Derivatives (fwidth) only in uniform control flow — WGSL requires it: every term is computed,
    // then masked (select / multiply), never inside a branch
    const lineAA = (v, w) => float(1).sub(clamp(abs(fract(v.sub(0.5)).sub(0.5)).div(max(fwidth(v), 1e-4)).sub(w), 0, 1));
    mat.colorNode = Fn(() => {
      const p = positionWorld.xz.add(U.uOrigin).toVar();
      const land = N.landField(p).toVar();
      const relief = N.reliefField(p, land), city = N.cityField(p, land);
      const px = length(fwidth(p)).toVar();                                       // world units per pixel
      // grid: minor every 40, major every 200 units; fades out where it would alias
      const gMin = max(lineAA(p.x.div(40), 0.2), lineAA(p.y.div(40), 0.2)).mul(float(1).sub(smoothstep(0.08, 0.3, px.div(40)))).toVar();
      const gMaj = max(lineAA(p.x.div(200), 0.45), lineAA(p.y.div(200), 0.45)).mul(float(1).sub(smoothstep(0.08, 0.3, px.div(200))));
      const col = U.uGrid.mul(max(gMin.mul(GROUND_K.minor), gMaj.mul(GROUND_K.major))).toVar();
      // sea: sparse dots
      const q = fract(p.div(16)).sub(0.5).mul(16);
      const dt = float(1).sub(smoothstep(0.6, 1.4, length(q).div(max(px, 1e-3)))).mul(float(1).sub(smoothstep(0.1, 0.25, px.div(16))));
      col.addAssign(U.uGrid.mul(dt).mul(GROUND_K.dots).mul(clamp(land.mul(-25), 0, 1)));
      // coastline
      const coast = float(1).sub(clamp(abs(land).div(max(fwidth(land), 1e-5)).sub(0.6), 0, 1));
      col.addAssign(U.uLand.mul(coast).mul(GROUND_K.coast));
      // contour lines on land, every fifth one brighter; faded where they crowd
      const k = relief.mul(14), idx = mod(floor(k.add(0.5)), 5);
      const c = lineAA(k, 0.15).mul(float(1).sub(smoothstep(0.25, 0.6, fwidth(k)))).mul(step(0, land));
      col.addAssign(U.uLand.mul(c).mul(select(idx.lessThan(0.5), GROUND_K.contour5, GROUND_K.contour)));
      // city blocks: random filled lots on an 8-unit lattice, a street every sixth lot
      const cp = p.div(8), ci = floor(cp), cf = fract(cp);
      const h = N.hashU(mod(ci.x, 8192), mod(ci.y, 8192), 11);
      const blk = mod(ci, 6);
      const lot = step(h, city.mul(0.5)).mul(step(0.5, blk.x)).mul(step(0.5, blk.y)).mul(step(0.18, cf.x)).mul(step(cf.x, float(0.82).sub(h.mul(0.3))))
        .mul(step(0.15, cf.y)).mul(step(cf.y, 0.85));
      col.addAssign(U.uLand.mul(lot).mul(h.mul(0.3).add(0.12)).mul(float(1).sub(smoothstep(0.15, 0.5, px.div(8)))));
      const fog = float(1).sub(smoothstep(U.uFog.x, U.uFog.y, distance(positionWorld, U.uCam)));   // per pixel: the mesh is huge
      const out = sRGBTransferEOTF(vec4(U.uBg.add(col.mul(fog)), 1)).rgb;   // display space → linear
      const dbg1 = vec3(select(land.greaterThan(0), 1, 0));
      return select(U.uDebug.lessThan(0.5), out, select(U.uDebug.lessThan(1.5), dbg1, vec3(gMin, px, fog)));
    })();
    const geo = new THREE.PlaneGeometry(GROUND_STEP * GROUND_CELLS, GROUND_STEP * GROUND_CELLS, GROUND_CELLS, GROUND_CELLS); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  },
  /* every frame: the mesh follows the camera's focus in whole world cells, the shader gets the wrapped origin */
  update(cam, focus) {
    const S = GROUND_STEP, ox = WORLD.origin.x, oz = WORLD.origin.z;
    this.mesh.position.set(Math.round((focus.x + ox) / S) * S - ox, 0, Math.round((focus.z + oz) / S) * S - oz);
    this.uniforms.uOrigin.value.set(wrapP(WORLD.origin.x), wrapP(WORLD.origin.z));
    this.uniforms.uCam.value.copy(cam.position);
    // the palette in display space (see GROUND_K)
    this.uniforms.uGrid.value.copy(PAL.grid).convertLinearToSRGB(); this.uniforms.uLand.value.copy(PAL.land).convertLinearToSRGB(); this.uniforms.uBg.value.copy(PAL.bg).convertLinearToSRGB();
    // fogged out before the mesh ends; the ground around the focus stays clear however far the camera is (zoom, phones)
    const dF = cam.position.distanceTo(focus), far = Math.min(GROUND_STEP * GROUND_CELLS * 0.45, Math.max(1800, cam.position.y * 4 + 1200, dF * 2.5));
    this.uniforms.uFog.value.set(Math.min(far * 0.8, Math.max(far * 0.3, dF * 1.15)), far);
  }
};

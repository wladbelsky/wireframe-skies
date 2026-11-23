'use strict';
/* ===== Periodic value noise — the same functions in JS and TSL (the ground's node material) =====
   The world tiles with period NOISE_P (units): every octave's lattice is NOISE_P / cell cells wide and the lattice
   index wraps, so coordinates can be reduced mod NOISE_P (WORLD.origin grows forever, the shader only gets it mod P).
   The lattice hash is integer arithmetic (u32 in the shader, Math.imul in JS): bit-identical on CPU and GPU, so ground
   units are placed on exactly the land / sea the ground shader draws. Keep both versions in sync (tests compare them). */
const NOISE_P = 65536;

function hashU(x, z, s) {   // x, z, s: non-negative integers → [0, 1)
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/* value noise at (x, z) in [0, NOISE_P), lattice cell size `cell` (NOISE_P / cell must be an integer), seed s */
function vnoise(x, z, cell, s) {
  const n = NOISE_P / cell, fx = x / cell, fz = z / cell;
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const x0 = ((ix % n) + n) % n, z0 = ((iz % n) + n) % n, x1 = (x0 + 1) % n, z1 = (z0 + 1) % n;
  const ux = tx * tx * (3 - 2 * tx), uz = tz * tz * (3 - 2 * tz);
  const a = hashU(x0, z0, s), b = hashU(x1, z0, s), c = hashU(x0, z1, s), d = hashU(x1, z1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const wrapP = v => ((v % NOISE_P) + NOISE_P) % NOISE_P;

/* ---- the terrain fields (world coordinates already wrapped) ----
   land(x, z): > 0 land, < 0 sea; the coastline is land = 0.
   relief(x, z): ≥ 0, contour lines are drawn on it (mountains get many).
   city(x, z): 0..1 built-up area (low land only). */
function landField(x, z) {
  const big = vnoise(x, z, 4096, 1);                                     // continents vs oceans
  const f = vnoise(x, z, 1024, 2) * 0.5 + vnoise(x, z, 512, 3) * 0.27 + vnoise(x, z, 256, 4) * 0.15 + vnoise(x, z, 128, 5) * 0.08;
  return f - 0.5 + (big - 0.5) * 0.5;
}
function mountField(x, z) { const m = vnoise(x, z, 2048, 6); return m * m * (3 - 2 * m); }
function reliefField(x, z, land) {
  const mt = clamp((mountField(x, z) - 0.45) / 0.3, 0, 1);
  const r = vnoise(x, z, 512, 7) * 0.6 + vnoise(x, z, 128, 8) * 0.3 + vnoise(x, z, 64, 9) * 0.1;
  return Math.max(land, 0) * (1.2 + mt * 5) + mt * r * Math.min(1, Math.max(land, 0) * 12) * 1.6;
}
/* terrain height in units: the relief scaled (mountains up to ~100), 0 at sea level; contour lines are every 1/14 of relief */
const HSCALE = 26;
const HMAX = (0.75 * 6.2 + 1.6) * HSCALE;   // upper bound: land ≤ 0.75, relief ≤ land · (1.2 + 5) + 1.6 (keep in sync with the fields)
function heightField(x, z, land) { return reliefField(x, z, land) * HSCALE; }
function cityField(x, z, land) {
  const c = clamp((vnoise(x, z, 512, 10) - 0.62) / 0.12, 0, 1);
  return c * clamp(land * 30, 0, 1) * clamp((0.2 - land) * 10, 0, 1);
}

/* ---- the same fields as TSL functions (NOISE_TSL.*, called with a vec2 node p and float nodes / numbers), compiled to
   WGSL (WebGPU) or GLSL (WebGL 2). Real shader functions (setLayout), like the old GLSL. u32 multiplication wraps the
   way Math.imul does; mod is floored in both backends (three polyfills it in WGSL). ---- */
const NOISE_TSL = (() => {
  const { Fn, uint, float, vec2, floor, mod, clamp, max, min, bitXor, shiftRight } = THREE.TSL;
  const F = (name, type, inputs, fn) => Fn(fn).setLayout({ name, type, inputs: inputs.map(([n, t]) => ({ name: n, type: t })) });
  const hashUi = F('hashUi', 'uint', [['x', 'uint'], ['z', 'uint'], ['s', 'uint']], ([x, z, s]) => {
    const h = x.mul(uint(374761393)).add(z.mul(uint(668265263))).add(s.mul(uint(1442695041))).toVar();
    h.assign(bitXor(h, shiftRight(h, uint(13))).mul(uint(1274126177)));
    h.assign(bitXor(h, shiftRight(h, uint(16))));
    return h;
  });
  const hashU = F('hashU', 'float', [['x', 'float'], ['z', 'float'], ['s', 'float']], ([x, z, s]) => float(hashUi(uint(x), uint(z), uint(s))).div(4294967296.0));
  const vnoise = F('vnoise', 'float', [['p', 'vec2'], ['cell', 'float'], ['s', 'float']], ([p, cell, s]) => {
    const n = float(NOISE_P).div(cell), f = p.div(cell), i = floor(f), t = f.sub(i);
    const x0 = mod(i.x, n), z0 = mod(i.y, n), x1 = mod(x0.add(1), n), z1 = mod(z0.add(1), n);
    const u = t.mul(t).mul(vec2(3).sub(t.mul(2)));
    const a = hashU(x0, z0, s), b = hashU(x1, z0, s), c = hashU(x0, z1, s), d = hashU(x1, z1, s);
    return a.add(b.sub(a).mul(u.x)).add(c.sub(a).mul(u.y)).add(a.sub(b).sub(c).add(d).mul(u.x).mul(u.y));
  });
  const landField = F('landField', 'float', [['p', 'vec2']], ([p]) => {
    const big = vnoise(p, 4096, 1);
    const f = vnoise(p, 1024, 2).mul(0.5).add(vnoise(p, 512, 3).mul(0.27)).add(vnoise(p, 256, 4).mul(0.15)).add(vnoise(p, 128, 5).mul(0.08));
    return f.sub(0.5).add(big.sub(0.5).mul(0.5));
  });
  const mountField = F('mountField', 'float', [['p', 'vec2']], ([p]) => { const m = vnoise(p, 2048, 6); return m.mul(m).mul(float(3).sub(m.mul(2))); });
  const reliefField = F('reliefField', 'float', [['p', 'vec2'], ['land', 'float']], ([p, land]) => {
    const mt = clamp(mountField(p).sub(0.45).div(0.3), 0, 1);
    const r = vnoise(p, 512, 7).mul(0.6).add(vnoise(p, 128, 8).mul(0.3)).add(vnoise(p, 64, 9).mul(0.1));
    const l = max(land, 0);
    return l.mul(mt.mul(5).add(1.2)).add(mt.mul(r).mul(min(1, l.mul(12))).mul(1.6));
  });
  const heightField = F('heightField', 'float', [['p', 'vec2'], ['land', 'float']], ([p, land]) => reliefField(p, land).mul(HSCALE));
  const cityField = F('cityField', 'float', [['p', 'vec2'], ['land', 'float']], ([p, land]) => {
    const c = clamp(vnoise(p, 512, 10).sub(0.62).div(0.12), 0, 1);
    return c.mul(clamp(land.mul(30), 0, 1)).mul(clamp(float(0.2).sub(land).mul(10), 0, 1));
  });
  return { hashU, vnoise, landField, mountField, reliefField, heightField, cityField };
})();

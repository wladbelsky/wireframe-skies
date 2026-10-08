'use strict';
/* ===== Periodic value noise — the same functions in JS and GLSL =====
   The world tiles with period NOISE_P (units): every octave's lattice is NOISE_P / cell cells wide and the lattice
   index wraps, so coordinates can be reduced mod NOISE_P (WORLD.origin grows forever, the shader only gets it mod P).
   The lattice hash is integer arithmetic (uint32 in GLSL, Math.imul in JS): bit-identical on CPU and GPU, so ground
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
function heightField(x, z, land) { return reliefField(x, z, land) * HSCALE; }
function cityField(x, z, land) {
  const c = clamp((vnoise(x, z, 512, 10) - 0.62) / 0.12, 0, 1);
  return c * clamp(land * 30, 0, 1) * clamp((0.2 - land) * 10, 0, 1);
}

const NOISE_GLSL = `
uint hashUi(uint x, uint z, uint s){ uint h = x*374761393u + z*668265263u + s*1442695041u; h = (h ^ (h >> 13u))*1274126177u; h ^= h >> 16u; return h; }
float hashU(float x, float z, float s){ return float(hashUi(uint(x), uint(z), uint(s))) / 4294967296.0; }
float vnoise(vec2 p, float cell, float s){
  float n = ${NOISE_P.toFixed(1)} / cell; vec2 f = p / cell, i = floor(f), t = f - i;
  float x0 = mod(i.x, n), z0 = mod(i.y, n), x1 = mod(x0 + 1.0, n), z1 = mod(z0 + 1.0, n);
  vec2 u = t * t * (3.0 - 2.0 * t);
  float a = hashU(x0, z0, s), b = hashU(x1, z0, s), c = hashU(x0, z1, s), d = hashU(x1, z1, s);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float landField(vec2 p){
  float big = vnoise(p, 4096.0, 1.0);
  float f = vnoise(p, 1024.0, 2.0) * 0.5 + vnoise(p, 512.0, 3.0) * 0.27 + vnoise(p, 256.0, 4.0) * 0.15 + vnoise(p, 128.0, 5.0) * 0.08;
  return f - 0.5 + (big - 0.5) * 0.5;
}
float mountField(vec2 p){ float m = vnoise(p, 2048.0, 6.0); return m * m * (3.0 - 2.0 * m); }
float reliefField(vec2 p, float land){
  float mt = clamp((mountField(p) - 0.45) / 0.3, 0.0, 1.0);
  float r = vnoise(p, 512.0, 7.0) * 0.6 + vnoise(p, 128.0, 8.0) * 0.3 + vnoise(p, 64.0, 9.0) * 0.1;
  return max(land, 0.0) * (1.2 + mt * 5.0) + mt * r * min(1.0, max(land, 0.0) * 12.0) * 1.6;
}
float heightField(vec2 p, float land){ return reliefField(p, land) * ${HSCALE.toFixed(1)}; }
float cityField(vec2 p, float land){
  float c = clamp((vnoise(p, 512.0, 10.0) - 0.62) / 0.12, 0.0, 1.0);
  return c * clamp(land * 30.0, 0.0, 1.0) * clamp((0.2 - land) * 10.0, 0.0, 1.0);
}
`;

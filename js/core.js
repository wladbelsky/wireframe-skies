'use strict';
/* ===== Shared utils, settings, palette, label textures ===== */
const V3 = THREE.Vector3;
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function angleWrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function approachAngle(cur, target, maxStep) { const d = angleWrap(target - cur); return cur + clamp(d, -maxStep, maxStep); }
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function wpick(cands) { let r = Math.random() * cands.reduce((s, c) => s + c.w, 0); for (const c of cands) if ((r -= c.w) <= 0) return c; return cands[cands.length - 1]; }
const UP = new V3(0, 1, 0);

/* Settings (overridden by Wallpaper Engine user properties) */
const CFG = {
  camMode: 'cinematic', // 'cinematic' (the director cuts between shots) | 'fixed'
  zoom: 100,            // %, bigger = closer
  fixedAz: 200,         // fixed camera: azimuth relative to the flight's heading, degrees (180 = straight behind)
  fixedElev: 32,        // fixed camera: elevation, degrees
  shotLen: 22,          // cinematic: average shot length, s
  sens: 100,            // audio sensitivity, %
  density: 100,         // enemy density, %
  enemyFire: true,      // enemies shoot back (they never hit)
  maneuvers: 5,         // how often the flight shows off (0..10)
  colors: { friend: '#46ff78', enemy: '#ff5a2e', ally: '#4fd4ff', grid: '#2c6fd0', land: '#bfe2ff' },
  allies: true,         // allied ships, ground units and aircraft on the map
  trail: 14,            // trail length, s (0 = off)
  dropLines: true,      // altitude lines down to the ground
  labels: true,         // callsigns / target names
  squad: 'STRIDER',     // the flight's callsign; planes are '<squad> 1..4'
  speed: 100            // flight speed, %
};

/* ===== Palette (THREE.Color, kept in sync with CFG.colors by applyColors) ===== */
const PAL = { friend: new THREE.Color(), enemy: new THREE.Color(), ally: new THREE.Color(), grid: new THREE.Color(), land: new THREE.Color(),
  bg: new THREE.Color(0x02060f), white: new THREE.Color(0xffffff), missile: new THREE.Color(0xe8f6ff), flare: new THREE.Color(0xffe6a0) };
const rgbFromWE = str => '#' + str.split(' ').map(c => Math.round(clamp(parseFloat(c), 0, 1) * 255).toString(16).padStart(2, '0')).join('');
function syncPalette() { for (const k in CFG.colors) PAL[k].set(CFG.colors[k]); }
syncPalette();
const cssOf = c => '#' + c.getHexString();

/* ===== Canvas textures ===== */
function radialTex(stops, size) {
  size = size || 64;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(s => gr.addColorStop(s[0], s[1]));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
const TEX = {
  glow: radialTex([[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,255,255,0.85)'], [0.4, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']])
};

/* ===== Text labels =====
   One texture per (text, colour, struck), shared through LABEL_CACHE and reference-counted by setLabel: when no sprite
   shows a label any more (a colour or the squadron name changed) its texture is freed, so edits never pile up. Sprites with sizeAttenuation off keep a constant size on screen.
   The look of the replay: wide-spaced, light, a near-white core with a glow in the side's colour. */
const LABEL_FONT = 26, LABEL_H = 44, LABEL_PAD = 12;
const LABEL_FACE = `400 ${LABEL_FONT}px "Bahnschrift", "Eurostile", "DIN Alternate", "Segoe UI", Arial, sans-serif`;
const LABEL_CACHE = new Map();
function labelMat(text, color, struck) {
  const key = text + '|' + color + '|' + (struck ? 1 : 0);
  let m = LABEL_CACHE.get(key);
  if (m) return m;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = () => { g.font = LABEL_FACE; g.letterSpacing = '3px'; };
  font(); const w = Math.ceil(g.measureText(text).width) + LABEL_PAD * 2;
  c.width = w; c.height = LABEL_H; font();
  const core = '#' + new THREE.Color(color).lerp(PAL.white, 0.55).getHexString(), y = LABEL_H / 2 + 1;
  g.textBaseline = 'middle'; g.shadowColor = color;
  g.fillStyle = color; g.shadowBlur = 14; g.fillText(text, LABEL_PAD, y); g.shadowBlur = 6; g.fillText(text, LABEL_PAD, y);
  g.shadowBlur = 0; g.fillStyle = core; g.fillText(text, LABEL_PAD, y);
  if (struck) { g.strokeStyle = core; g.shadowColor = color; g.shadowBlur = 8; g.lineWidth = 3; g.beginPath(); g.moveTo(LABEL_PAD - 6, y); g.lineTo(w - LABEL_PAD + 6, y); g.stroke(); }
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false });
  m.userData.shared = true; m.userData.aspect = w / LABEL_H; m.userData.key = key; m.userData.refs = 0;
  LABEL_CACHE.set(key, m);
  return m;
}
/* label sprite: bottom-left corner at the anchor; setLabel swaps its material */
const LABEL_SCALE = 0.027;   // height at distance 1 (camera fov 40°: ≈ 3.7 % of the screen height, the glow included)
function makeLabel() { const s = new THREE.Sprite(); s.center.set(0.02, 0.3); s.renderOrder = 10; return s; }
function setLabel(s, text, color, struck) {
  const m = labelMat(text, color, struck), old = s.material; if (old === m) return;
  m.userData.refs++;
  if (old.userData.key && --old.userData.refs <= 0) { LABEL_CACHE.delete(old.userData.key); old.map.dispose(); old.dispose(); }
  s.material = m; s.scale.set(LABEL_SCALE * m.userData.aspect, LABEL_SCALE, 1);
}

/* ===== Line-segment builder (glyphs) ===== */
class Seg {
  constructor() { this.p = []; }
  line(a, b) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2]); return this; }
  poly(pts, closed) { for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) this.line(pts[i], pts[(i + 1) % pts.length]); return this; }
  ring(cx, cy, cz, r, n, axis) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, u = Math.cos(a) * r, v = Math.sin(a) * r;
      pts.push(axis === 'y' ? [cx + u, cy, cz + v] : axis === 'x' ? [cx, cy + u, cz + v] : [cx + u, cy + v, cz]);
    }
    return this.poly(pts, true);
  }
}

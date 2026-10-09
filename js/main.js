'use strict';
/* ===== Scene, Wallpaper Engine properties, main loop ===== */
let scene, camera, renderer;
let T = 0, paused = false, fpsLimit = 0, lastMs = 0, ready = false;

/* ---- URL test parameters (browser preview) ---- */
const QS = new URLSearchParams(location.search);
const qNum = k => { const v = parseFloat(QS.get(k)); return Number.isFinite(v) ? v : null; };   // a mistyped value is ignored, not NaN
if (qNum('zoom') != null) CFG.zoom = qNum('zoom');
if (QS.has('cam')) CFG.camMode = QS.get('cam') === 'fixed' ? 'fixed' : 'cinematic';

/* ---- Wallpaper Engine properties ---- */
const squadName = s => (String(s || '').toUpperCase().replace(/[^A-Z0-9 \-]/g, '').trim().slice(0, 14)) || 'STRIDER';
window.wallpaperPropertyListener = {
  applyUserProperties(p) {
    const has = k => p[k] !== undefined && p[k] !== null;
    if (has('cameramode')) CFG.camMode = p.cameramode.value === 'fixed' ? 'fixed' : 'cinematic';
    if (has('zoom')) CFG.zoom = p.zoom.value;
    if (has('fixedazimuth')) CFG.fixedAz = p.fixedazimuth.value;
    if (has('fixedelevation')) CFG.fixedElev = p.fixedelevation.value;
    if (has('shotlength')) CFG.shotLen = p.shotlength.value;
    if (has('audiosensitivity')) CFG.sens = p.audiosensitivity.value;
    if (has('enemydensity')) CFG.density = p.enemydensity.value;
    if (has('enemiesfire')) CFG.enemyFire = p.enemiesfire.value;
    if (has('maneuvers')) CFG.maneuvers = p.maneuvers.value;
    if (has('friendcolor')) CFG.colors.friend = rgbFromWE(p.friendcolor.value);
    if (has('enemycolor')) CFG.colors.enemy = rgbFromWE(p.enemycolor.value);
    if (has('gridcolor')) CFG.colors.grid = rgbFromWE(p.gridcolor.value);
    if (has('landcolor')) CFG.colors.land = rgbFromWE(p.landcolor.value);
    if (has('traillength')) CFG.trail = p.traillength.value;
    if (has('droplines')) CFG.dropLines = p.droplines.value;
    if (has('labels')) CFG.labels = p.labels.value;
    if (has('allies')) CFG.allies = p.allies.value;
    if (has('allycolor')) CFG.colors.ally = rgbFromWE(p.allycolor.value);
    if (has('squadname')) CFG.squad = squadName(p.squadname.value);
    if (has('flightspeed')) CFG.speed = p.flightspeed.value;
    applySettings();
  },
  applyGeneralProperties(p) { if (p.fps !== undefined) fpsLimit = p.fps; },
  setPaused(v) { paused = v; }
};
function applySettings() {
  syncPalette();
  if (!ready) return;
  SQUAD.recolor(); ENEMIES.recolor(); ALLIES.recolor();
  // a shorter shot length applies now, not after the running shot / hero (up to 1.2 × the old length)
  CAM.shotT = Math.min(CAM.shotT, CFG.shotLen * 1.2); CAM.heroT = Math.min(CAM.heroT, CFG.shotLen * 1.2);
}

/* ---- init ---- */
function init() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, precision: 'highp', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  scene = new THREE.Scene(); scene.background = PAL.bg;
  camera = new THREE.PerspectiveCamera(40, 16 / 9, 1, 6000);
  TERRAIN.build(scene);
  LINES.build(scene); GLOW.build(scene); BURSTS.build(); MISSILES.build(); TRACERS.build();
  ROUTE.heading = ROUTE.tgtHeading = rand(0, TAU); ROUTE.update(0);
  SQUAD.build(scene);
  for (const sys of [ROUTE, SQUAD, ENEMIES, ALLIES, MISSILES, TRACERS, GLOW, BURSTS, CAM]) WORLD.onShift((dx, dz) => sys.shift(dx, dz));
  CAM.nextShot();
  ready = true;
  window.addEventListener('resize', resize);
  applySettings(); resize(); CAM.update(0);
  requestAnimationFrame(frame);
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight); camera.updateProjectionMatrix();
  setLabelScale(camera.aspect);
}

/* ---- simulation step (sim time T) ---- */
const SPLASH_T = 2.5;   // the start-up splash covers the first seconds (scene build, settings, first frames)
let splash = document.getElementById('splash');
function step(dt) {
  T += dt;
  if (splash && T > SPLASH_T) { const s = splash; splash = null; s.classList.add('off'); setTimeout(() => s.remove(), 800); }
  updateArming();
  SQUAD.update(dt);
  ENEMIES.update(dt);
  ALLIES.update(dt);
  MISSILES.update(dt);
  TRACERS.update(dt);
  GLOW.update(dt);
  BURSTS.update(dt);
  CAM.update(dt);
  WORLD.recenter(ROUTE.pos.x, ROUTE.pos.z);
}
/* ---- per-frame visuals (after the steps): dynamic lines, glow points, ground ---- */
function draw() {
  LINES.begin(); GLOW.begin();
  SQUAD.draw(); ALLIES.draw(); ENEMIES.draw(); MISSILES.draw();   // the flight first: if LINES ever fills up, it is never what drops out (additive, so order doesn't show)
  TRACERS.draw(); BURSTS.draw(); GLOW.drawParts();
  const c = renderer.domElement;
  LINES.end(c.width, c.height, renderer.getPixelRatio()); GLOW.end(camera, c.height);
  TERRAIN.update(camera, CAM.focus);
  renderer.render(scene, camera);
}

/* ---- main loop ---- */
const TIME_SCALE = Math.max(1, Math.round(qNum('ts') || 1));
let frameDue = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  if (paused) { lastMs = ms; return; }
  if (fpsLimit > 0) {
    // due times advance in whole intervals, so the limit holds on any refresh rate (75 / 144 Hz…)
    if (ms < frameDue - 2) return;
    frameDue += 1000 / fpsLimit; if (frameDue <= ms) frameDue = ms + 1000 / fpsLimit;
  }
  // simulate the real elapsed time in sub-steps of at most 50 ms: low FPS limits don't slow the world down
  const el = clamp((ms - lastMs) / 1000, 0, 0.25); lastMs = ms;
  const n = Math.max(1, Math.ceil(el / 0.05)), dt = el / n;
  for (let i = 0; i < n * TIME_SCALE; i++) step(dt);
  draw();
}

init();

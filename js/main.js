'use strict';
/* ===== Scene, Wallpaper Engine properties, main loop ===== */
let scene, camera, renderer;
let T = 0, paused = false, fpsLimit = 0, lastMs = 0, ready = false, shadersReady = false;
const GPU = { webgpu: false };   // the backend WebGPURenderer ended up with (set once renderer.init() is done)

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
    if (has('bossevery')) CFG.bossEvery = p.bossevery.value;
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
    if (has('bloom')) CFG.bloom = p.bloom.value;
    if (has('bloomstrength')) CFG.bloomStrength = p.bloomstrength.value;
    applySettings();
  },
  applyGeneralProperties(p) { if (p.fps !== undefined) fpsLimit = p.fps; },
  setPaused(v) { paused = v; }
};
function applySettings() {
  syncPalette();
  if (!ready) return;
  SQUAD.recolor(); ENEMIES.recolor(); ALLIES.recolor();
  updatePipeline();
  // a shorter shot length applies now, not after the running shot / hero (up to 1.2 × the old length)
  CAM.shotT = Math.min(CAM.shotT, CFG.shotLen * 1.2); CAM.heroT = Math.min(CAM.heroT, CFG.shotLen * 1.2);
}

/* ---- init ----
   WebGPU where the browser has it (Wallpaper Engine's CEF does), WebGL 2 otherwise or with ?gl=webgl2: the same TSL
   node materials either way. The scene is built synchronously (ready); the frame loop starts once renderer.init() and
   the shader warm-up are done (shadersReady) — until then T stands still and the splash stays. */
function init() {
  const canvas = document.getElementById('c');
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: QS.get('gl') === 'webgl2' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  scene = new THREE.Scene(); scene.background = PAL.bg;
  camera = new THREE.PerspectiveCamera(40, 16 / 9, 1, 6000);
  TERRAIN.build(scene);
  LINES.build(scene); GLOW.build(scene); BURSTS.build(); MISSILES.build(); TRACERS.build(); BOSSES.build();
  ROUTE.heading = ROUTE.tgtHeading = rand(0, TAU); ROUTE.update(0);
  SQUAD.build(scene);
  for (const sys of [ROUTE, SQUAD, ENEMIES, ALLIES, BOSSES, MISSILES, TRACERS, GLOW, BURSTS, CAM]) WORLD.onShift((dx, dz) => sys.shift(dx, dz));
  CAM.nextShot();
  initPipeline();
  ready = true;
  window.addEventListener('resize', resize);
  applySettings(); resize(); CAM.update(0);
  // three's own animation loop drives the frames (it resets renderer.info once per frame)
  renderer.init().then(() => { GPU.webgpu = !!renderer.backend.isWebGPUBackend; return warmShaders(); })
    .then(() => { shadersReady = true; renderer.setAnimationLoop(frame); }, e => {
      console.error('renderer could not start', e); const s = document.querySelector('#splash .s'); if (s) s.textContent = 'NO WEBGPU / WEBGL 2 — CANNOT RENDER';
    });
}
/* Shader warm-up: compileAsync (async pipelines / KHR_parallel_shader_compile) instead of compiling everything on the
   first frame, so the splash keeps moving while the ground shader compiles. compile() only walks visible objects:
   everything hidden (label sprites, trails, empty pools) is shown during its synchronous part. Every scene material
   exists by now (all labels share one pipeline, all trails another); the first frame compiles only the small post
   passes (bloom, output quad), still under the splash — nothing compiles after that (render.spec.js). */
const WARM_WAIT = 8000;   // ms: start anyway if a compile never reports back
async function warmShaders() {
  const hidden = []; scene.traverse(o => { if (!o.visible) hidden.push(o); });
  const counts = [GLOW.mesh.count, LINES.mesh.geometry.instanceCount];
  hidden.forEach(o => { o.visible = true; }); GLOW.mesh.count = 1; LINES.mesh.geometry.instanceCount = 1;
  const ps = [], mask = camera.layers.mask;
  try {
    ps.push(PIPE.on ? PIPE.scene.compileAsync(renderer) : renderer.compileAsync(scene, camera));
    if (PIPE.on) { camera.layers.set(LABEL_LAYER); ps.push(PIPE.names.compileAsync(renderer)); }   // its own target (half res, no MSAA)
  } finally { camera.layers.mask = mask; hidden.forEach(o => { o.visible = false; }); GLOW.mesh.count = counts[0]; LINES.mesh.geometry.instanceCount = counts[1]; }
  await Promise.race([Promise.all(ps.map(p => p.catch(e => { console.warn('shader warm-up failed', e); }))), new Promise(r => setTimeout(r, WARM_WAIT))]);
}

/* ---- render pipeline (RenderPipeline): the scene pass plus bloom (CFG.bloom: glow around what is brighter than the
   threshold — glyph cores, missiles, bursts — and a highlight roll-off (rolloff()), so overlapping additive lines fade
   to white instead of clipping). The names have no glow of their own (core.js labelMat) and their light cores sit
   around the threshold (red ones below it): a half-resolution pass of LABEL_LAYER adds them × BLOOM.names to the
   bloom's input only — every name glows, the text on screen and the map stay as they are.
   Bloom off: plain renderer.render. ---- */
const BLOOM = { strength: 0.5, radius: 0.45, threshold: 0.75, knee: 0.3, names: 1.2 };   // strength at CFG.bloomStrength = 100 %; threshold: linear luminance (glyph cores, not the map)
const PIPE = { on: false, key: null, rp: null, scene: null, names: null, bloom: null };
function initPipeline() {
  PIPE.scene = THREE.TSL.pass(scene, camera);
  const L = new THREE.Layers(); L.set(LABEL_LAYER);
  PIPE.names = THREE.TSL.pass(scene, camera, { samples: 0 }).setResolutionScale(0.5); PIPE.names.setLayers(L);
  PIPE.rp = new THREE.RenderPipeline(renderer);
}
function updatePipeline() {   // after a property change; a new combination compiles its passes on the next frame
  if (!PIPE.rp) return;
  const k = bloomK(), key = k > 0 ? 'b' : '';
  if (PIPE.bloom) PIPE.bloom.strength.value = k;
  if (key === PIPE.key) return;
  PIPE.key = key; PIPE.on = key !== '';
  if (PIPE.bloom) { PIPE.bloom.dispose(); PIPE.bloom = null; }
  if (!PIPE.on) return;
  PIPE.bloom = THREE.bloom(PIPE.scene.add(PIPE.names.mul(BLOOM.names)), k, BLOOM.radius, BLOOM.threshold); PIPE.bloom.smoothWidth.value = BLOOM.knee;
  PIPE.rp.outputNode = rolloff(PIPE.scene.add(PIPE.bloom)); PIPE.rp.needsUpdate = true;
}
const bloomK = () => CFG.bloom ? BLOOM.strength * clamp(CFG.bloomStrength, 0, 300) / 100 : 0;
/* Khronos PBR Neutral tone mapping without its toe: identity while the brightest channel stays under 0.76, then a
   smooth roll-off towards white, desaturating (as in carrier-wallpaper) */
function rolloff(c) {
  const { Fn, vec3, vec4, float, max, mix } = THREE.TSL;
  return Fn(() => {
    const col = c.rgb.toVar(), peak = max(col.r, max(col.g, col.b)).toVar(), s = float(0.76), d = float(0.24);
    const np = float(1).sub(d.mul(d).div(peak.add(d).sub(s)));
    const comp = col.mul(np.div(max(peak, 1e-4))), g = float(1).sub(float(1).div(peak.sub(np).mul(0.15).add(1)));
    return vec4(peak.lessThan(s).select(col, mix(comp, vec3(np), g)), 1);
  })();
}
/* the only place a frame is rendered (the test harness renders through draw() too) */
function renderFrame() { if (PIPE.on) PIPE.rp.render(); else renderer.render(scene, camera); }
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
  SQUAD.draw(); ALLIES.draw(); ENEMIES.draw(); BOSSES.draw(); MISSILES.draw();   // the flight first: if LINES ever fills up, it is never what drops out (additive, so order doesn't show)
  TRACERS.draw(); BURSTS.draw(); GLOW.drawParts();
  const c = renderer.domElement;
  LINES.end(c.width, c.height, renderer.getPixelRatio()); GLOW.end(camera, c.height);
  TERRAIN.update(camera, CAM.focus);
  renderFrame();
}

/* ---- main loop ---- */
const TIME_SCALE = Math.max(1, Math.round(qNum('ts') || 1));
let frameDue = 0;
function frame(ms) {
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

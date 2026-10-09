/* In-page test helpers (injected with addInitScript before the wallpaper's scripts; everything here is resolved at
   call time, so the wallpaper's globals — SQUAD, ENEMIES, step, … — are available by then). Exposed as window.__t. */
(() => {
  'use strict';
  const H = window.__t = {};
  let rt = 1000;                       // simulated real time (RT): arming, beat gaps and hold timers run on it
  const DT = 0.05;
  H.MODES = new Set(['form', 'engage', 'reposition', 'rejoin']);
  H.ENEMY_STATES = new Set(['live', 'struck', 'fade', 'retreat']);
  H.BOUND = 3000;                      // floating origin: no local coordinate ever gets further out than this

  H.rt = () => rt;
  /* after boot: real time runs on simulated time */
  H.setup = () => {
    window.RT = () => rt;
    if (!THREE.BufferGeometry.prototype.__patched) {           // mark disposed geometries (leak detection, below)
      const d = THREE.BufferGeometry.prototype.dispose;
      THREE.BufferGeometry.prototype.dispose = function () { this.__disposed = true; return d.call(this); };
      THREE.BufferGeometry.prototype.__patched = true;
    }
    H.reset();
  };
  H.reset = () => { H.minY = Infinity; H.maxShots = 0; };

  /* ---- audio: a synthetic 120 bpm track (kick on the beat, snare on 2 and 4, hats) or silence ---- */
  const arr = new Array(128).fill(0);
  H.audioFrame = (on) => {
    arr.fill(0);
    if (on) {
      const ph = rt % 0.5, beat = Math.floor(rt / 0.5);
      for (let i = 0; i < 128; i++) arr[i] = 0.12 + 0.03 * Math.sin(i + rt * 7);
      if (ph < 0.06) for (let i = 0; i < 5; i++) { arr[i] = 0.95; arr[64 + i] = 0.95; }
      if (beat % 2 && ph < 0.05) for (let i = 6; i < 23; i++) { arr[i] = 0.8; arr[64 + i] = 0.8; }
      if (ph > 0.25 && ph < 0.29) for (let i = 26; i < 57; i++) { arr[i] = 0.6; arr[64 + i] = 0.6; }
    }
    return arr;
  };
  const feed = (on) => { const a = H.audioFrame(on); (window.__audio || onAudio)(a); };

  /* ---- invariants checked after every step ---- */
  const fin = v => Number.isFinite(v.x + v.y + v.z);
  const far = v => Math.abs(v.x) > H.BOUND || Math.abs(v.z) > H.BOUND;
  H.checkInvariants = () => {
    const v = [];
    for (const p of SQUAD.planes) {
      const w = `plane ${p.idx + 1}[${p.mode}${p.man ? ':' + p.man.name : ''}]`;
      if (!fin(p.pos) || !fin(p.dir) || !fin(p.up) || !Number.isFinite(p.speed)) v.push(`${w} non-finite state`);
      if (Math.abs(p.dir.length() - 1) > 1e-3 || Math.abs(p.up.length() - 1) > 1e-3 || Math.abs(p.dir.dot(p.up)) > 1e-3) v.push(`${w} basis not orthonormal`);
      const agl = p.agl;
      if (agl < FLOOR * 0.6 + 0.01 - 1e-6) v.push(`${w} on the ground floor (agl=${agl.toFixed(1)})`);
      if (p.pos.y > CEIL + 60) v.push(`${w} too high (y=${p.pos.y.toFixed(1)})`);
      if (far(p.pos)) v.push(`${w} far from the origin (${p.pos.x.toFixed(0)}, ${p.pos.z.toFixed(0)})`);
      if (!H.MODES.has(p.mode)) v.push(`${w} unknown mode`);
      if (!p.alive) v.push(`${w} lost`);
      if (p.target && (!p.target.alive || !ENEMIES.list.includes(p.target))) v.push(`${w} chasing a dead / freed target`);
      if (p.mode === 'engage' && !p.target) v.push(`${w} engaging nothing`);
      H.minY = Math.min(H.minY, agl);   // lowest height above the ground
    }
    if (!SQUAD.engaged && SQUAD.planes.some(p => p.mode === 'engage')) v.push('engaging out of combat');
    if (SQUAD.alert && (!SQUAD.engaged || SQUAD.planes.some(p => p.mode === 'engage' || p.mode === 'reposition' || (p.man && p.man.name === 'breakTurn')))) v.push('fighting before the first contact');
    if (SQUAD.mopT > 0 && SQUAD.planes.some(p => p.target && !p.target.mop)) v.push('mop-up target not marked');
    if (SQUAD.mopT <= 0 && ENEMIES.list.some(e => e.mop && e.alive && !AUD.armed)) v.push('mop flag outside the mop-up');
    for (const e of [...ENEMIES.list, ...ALLIES.list]) {
      if (!e.inUse) v.push(`freed ${e.type} still listed`);
      if (!H.ENEMY_STATES.has(e.state)) v.push(`${e.type} unknown state ${e.state}`);
      if (e.alive !== (e.state === 'live')) v.push(`${e.type} alive / state mismatch`);
      if (!fin(e.pos)) v.push(`${e.type} non-finite position`);
      if (far(e.pos)) v.push(`${e.type} far from the origin`);
      if (e.chasers < 0 || e.incoming < 0) v.push(`${e.type} negative counters`);
      if (e.ty.cls === 'sea' && e.state === 'live' && TERRAIN.land(e.pos.x, e.pos.z) > 0) v.push(`${e.type} on land`);
      if (e.ground && e.state === 'live' && Math.abs(e.pos.y - TERRAIN.height(e.pos.x, e.pos.z)) > 1e-6) v.push(`${e.type} not on the ground (y=${e.pos.y.toFixed(2)})`);
      if (e.plane && e.state === 'live' && e.plane.agl < FLOOR * 0.6 - 1e-3) v.push(`${e.type} below the ground floor`);
      if (e.ty.cls === 'ground' && e.state === 'live' && TERRAIN.land(e.pos.x, e.pos.z) < 0) v.push(`${e.type} in the sea`);
    }
    const chasers = new Map(); for (const p of SQUAD.planes) if (p.target) chasers.set(p.target, (chasers.get(p.target) || 0) + 1);
    for (const e of ENEMIES.list) if ((chasers.get(e) || 0) !== e.chasers) v.push(`${e.type} chasers ${e.chasers} ≠ ${chasers.get(e) || 0}`);
    if (ENEMIES.alive > Math.max(ENEMIES.cap, 4) + 4) v.push(`too many enemies alive: ${ENEMIES.alive}`);
    for (const F of [ENEMIES, ALLIES]) for (const [k, pool] of Object.entries(F.slots)) if (pool.length > F.types[k].max) v.push(`${k} pool ${pool.length}`);
    if (ALLIES.alive > ALLY_CAP) v.push(`too many allies: ${ALLIES.alive}`);
    if (ALLIES.list.some(e => e.state !== 'live' && e.state !== 'fade')) v.push('an ally was struck');
    for (const m of MISSILES.pool) if (m.on && (!fin(m.p) || far(m.p))) v.push('missile out of bounds');
    if (far(ROUTE.pos) || far(CAM.focus)) v.push('route / camera far from the origin');
    if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) v.push('camera non-finite');
    return v;
  };

  /* ---- the simulation driver ----
     o.audio: true (music) / false (silence) / undefined (no audio input at all)
     o.check: run checkInvariants after every step (default true); o.until: stop early when it returns true */
  H.sim = (sec, o = {}) => {
    const n = Math.round(sec / DT), violations = [];
    const check = o.check !== false;
    let i = 0;
    for (; i < n; i++) {
      if (o.audio !== undefined) feed(o.audio);
      step(DT); rt += DT;
      if (o.draw) draw();   // per-frame visuals too (LINES / GLOW fill-up)
      if (check) for (const s of H.checkInvariants()) if (violations.length < 25) violations.push(`T=${T.toFixed(2)} ${s}`);
      if (o.until && o.until()) { i++; break; }
    }
    return { violations, steps: i, t: T };
  };
  /* combat without the arming delay: fighting until fightOff() */
  let activeDesc = null;   // AUD's own 'active' getter, put back by fightOff
  H.forceFight = () => {
    if (!activeDesc) activeDesc = Object.getOwnPropertyDescriptor(AUD, 'active');
    Object.defineProperty(AUD, 'active', { configurable: true, get: () => true });
    AUD.soundStart = rt - 10; AUD.lastActive = rt; AUD.combat = true; AUD.holdUntil = 0;
  };
  H.fightOff = () => { if (activeDesc) Object.defineProperty(AUD, 'active', activeDesc); AUD.lastActive = rt - 100; AUD.soundStart = -1; };
  H.stats = () => ({ T, armed: AUD.armed, mopT: SQUAD.mopT, fighting: AUD.fighting, enemies: ENEMIES.list.length, alive: ENEMIES.alive, kills: ENEMIES.kills, allies: ALLIES.list.length, allyShots: ALLIES.shots,
    spawned: ENEMIES.spawned, shots: SQUAD.shots, hostile: ENEMIES.missiles, modes: SQUAD.planes.map(p => p.mode), shifts: WORLD.shifts });

  /* ---- rendering ---- */
  H.render = () => draw();
  /* average colour [r, g, b] (0..255) of a rectangle in CSS pixels (y from the top), read straight after a render */
  H.sample = (x, y, w, h) => {
    H.render();
    const gl = renderer.getContext(), c = renderer.domElement, sx = c.width / innerWidth, sy = c.height / innerHeight;
    const px = Math.round(x * sx), py = Math.round(c.height - (y + h) * sy), pw = Math.max(1, Math.round(w * sx)), ph = Math.max(1, Math.round(h * sy));
    const buf = new Uint8Array(pw * ph * 4); gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const s = [0, 0, 0]; for (let i = 0; i < buf.length; i += 4) { s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; }
    const n = buf.length / 4; return s.map(x => x / n);
  };
  /* screen position (CSS px) of a world point, or null behind the camera */
  H.screen = (p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera); if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  };
  /* Geometry leaks: every geometry reachable at a check (scene + model caches) is remembered; one that later is
     neither reachable nor disposed was dropped without dispose() — a leak (the wallpaper never restarts). */
  H.geoSeen = new Set();
  H.geometries = () => {
    H.render();
    const g = new Set();
    scene.traverse(x => { if (x.geometry) g.add(x.geometry); });
    for (const x of g) H.geoSeen.add(x);
    const leaked = [...H.geoSeen].filter(x => !g.has(x) && !x.__disposed);
    return { gpu: renderer.info.memory.geometries, reach: g.size, leaked: leaked.length, leakedTypes: [...new Set(leaked.map(x => x.type))] };
  };
  /* ground shader water mask (uDebug 1) at a CSS pixel vs the JS land field at the ground point under it */
  H.groundCheck = (n) => {
    const out = { n: 0, bad: 0, cases: [] };
    TERRAIN.uniforms.uDebug.value = 1; draw();
    const shown = scene.children.filter(o => o !== TERRAIN.mesh && o.visible); shown.forEach(o => { o.visible = false; });
    renderer.render(scene, camera);                       // the ground alone: no lines / labels drawn over it
    const gl = renderer.getContext(), c = renderer.domElement, buf = new Uint8Array(4), ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const x = Math.random() * innerWidth, y = innerHeight * (0.3 + Math.random() * 0.7);
      ray.setFromCamera({ x: x / innerWidth * 2 - 1, y: 1 - y / innerHeight * 2 }, camera);
      if (!ray.ray.intersectPlane(plane, hit)) continue;
      const land = TERRAIN.land(hit.x, hit.z); if (Math.abs(land) < 0.01) continue;   // too close to the coast to judge
      gl.readPixels(Math.round(x * c.width / innerWidth), Math.round(c.height - y * c.height / innerHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      out.n++; if ((buf[0] > 127) !== (land > 0)) { out.bad++; if (out.cases.length < 5) out.cases.push({ x, y, land, px: buf[0] }); }
    }
    TERRAIN.uniforms.uDebug.value = 0; shown.forEach(o => { o.visible = true; });
    return out;
  };
  H.props = (o) => window.wallpaperPropertyListener.applyUserProperties(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }])));
})();

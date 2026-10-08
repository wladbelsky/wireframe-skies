# Wireframe Skies — Wallpaper Engine web wallpaper

A mission-replay style three.js scene: a four-ship flight over a wireframe map (grid, coastlines, contour lines,
cities) that fights enemy aircraft, SAM sites, guns and ships while system audio plays.
Runs 24/7 inside Wallpaper Engine (CEF/Chromium); also previewable in a normal browser.
User-facing docs: `README.md` (keep it in sync when behaviour or properties change).
Sister project and the reference for conventions: `wladbelsky/carrier-wallpaper`.

## Stack & layout
- Plain JS, no build step, no npm. `'use strict'` classic scripts sharing **global** scope
  (no modules). three.js **r149** is vendored as `js/three.min.js` — never edit it. Needs WebGL2 (the ground
  shader uses `uint` arithmetic).
- `index.html` loads scripts in dependency order (later files use globals of earlier ones):
  `core → noise → terrain → flight → models → effects → audio → squad → enemies → camera → main → properties → settings`,
  then an inline script registers the WE audio listener (or starts the browser demo beat).
  `main.js` calls `init()` at its end, so anything `init()` needs must be defined before `main.js`.

| File | Contents |
|---|---|
| `js/core.js` | utils (`V3`, `rand`, `clamp`, `lerp`, `smoothstep`, `pick`, `wpick`…), `CFG` defaults, `PAL` colours (`syncPalette`), `TEX.glow`, label sprites (`labelMat` cache, `makeLabel`, `setLabel`), `Seg` line-segment builder, `disposeTree` |
| `js/noise.js` | periodic value noise + the terrain fields `landField` / `mountField` / `reliefField` / `cityField` — **in JS and in GLSL (`NOISE_GLSL`)**, keep both in sync |
| `js/terrain.js` | `WORLD` (floating origin, `onShift` handlers), `TERRAIN` (fields at a local position, `isLand` / `isSea`, the ground mesh + shader) |
| `js/flight.js` | `Plane` flight model (`steer`, `maneuver`, `move`, `sync`), `FLOOR` / `CEIL`, `MANEUVERS` + `tryManeuver` |
| `js/models.js` | line-art model definitions `MODEL_DEFS` (jet, heavy, heli, sam, aagun, tank, radar, frigate, destroyer), `modelGeo` cache, `buildModel`, `lineMaterial` / `fillMaterial` |
| `js/effects.js` | `Trail`, `LINES` (per-frame segments: altitude lines, poles, cross-outs, tracers, missile smoke), `GLOW` (points: sparks, flares, missile heads), `BURSTS`, `MISSILES`, `TRACERS` |
| `js/audio.js` | `AUD`, `BANDS`, `onAudio` (beat detection), `updateArming`, `onBeat` → `SQUAD.onBeat` / `ENEMIES.onBeat`, browser `DEMO` beat, `FILE_AUDIO` |
| `js/squad.js` | `ROUTE` (the virtual lead point), `FORMATIONS`, `SQUAD` (peace formation flying, combat AI, shooting, evasion, flares, rejoin) |
| `js/enemies.js` | `ENEMY_TYPES`, `ENEMIES` (pooled slots, waves, air / ground / sea behaviour, hostile fire, `damage` → struck → fade) |
| `js/camera.js` | `SHOTS`, `CAM` (cinematic director / fixed camera, hero plane in combat, `right` / `upv` screen axes) |
| `js/main.js` | WE property listener → `CFG`, `init()`, `step(dt)` (simulation), `draw()` (per-frame visuals + render), `frame()` main loop |
| `js/properties.js` | **generated** from `project.json` — do not edit by hand |
| `js/settings.js` | browser-only settings drawer, demo beat, audio-file player (returns early inside WE) |
| `tools/gen_properties.py` | regenerates `js/properties.js` |
| `tests/`, `playwright.config.js`, `package.json` | automated tests (Playwright Test) — see "Running & testing"; `tools/test.ps1` runs them in Docker, `.github/workflows/tests.yml` in CI |

## Rules / conventions
- **After changing any JS/CSS file, bump the cache-buster** `?v=N` on all `<script>`/`<link>` tags in
  `index.html` (WE's CEF caches aggressively). Current: `v=12`.
- **New WE property**: add it to `project.json`, read it in `applyUserProperties` (`main.js`) into `CFG`,
  then run `python tools/gen_properties.py`. Property `order` decides the browser-drawer group
  (0–9 camera, 10–19 audio & combat, 20–29 look, 30–39 flight). `repo.spec.js` checks every property is read.
- Match the existing style: dense one-liners, short comments, `const` scratch vectors at module level.
- Sim time is `T` (advances only in `step(dt)`); real time is `RT()` (audio arming, beat gaps).
- **Simulation vs drawing:** `step(dt)` runs several times per frame (≤ 50 ms sub-steps); anything that fills the
  per-frame buffers (`LINES`, `GLOW.dot`) belongs in a `draw()` method called once from `main.js draw()`.
  `GLOW.spawn` (particles) is fine from the simulation.
- **No text overlays**: the only text is in the scene (callsigns, enemy names) — the look of the replay without
  its result tables. The settings drawer exists only in a normal browser.
- **Combat state** is latched in `updateArming()` (`audio.js`, first thing in `step`): sound for `ARM_DELAY` s →
  `AUD.combat` (`AUD.armed`). When the sound stops, `AUD.holding` for `DISARM_DELAY` s (still armed, but not
  `AUD.fighting`: no new waves, no firing on the beat), then stand-down; sound for `RESUME_DELAY` s resumes it.
  Use `AUD.fighting` for spawning / firing, `AUD.armed` for "combat mode" (planes fight instead of flying formation).

## World, terrain, floating origin
- Ground is the plane y = 0; the map is drawn only by the ground fragment shader (`terrain.js`). Nothing is
  generated per chunk: the fields are functions of the world position.
- **Floating origin:** world = local + `WORLD.origin`. `WORLD.recenter` (from `step`) shifts the origin to `ROUTE.pos`
  when it is > `RECENTER` units out and calls every `WORLD.onShift` handler with `(dx, dz)`. **Anything new that
  stores positions must register a `shift(dx, dz)`** (see the list in `init()`), or it jumps on the next recentre.
- **Noise is periodic** (`NOISE_P`): every octave's lattice wraps, so the shader only gets `WORLD.origin mod NOISE_P`
  and stays precise forever. A new octave's cell size must divide `NOISE_P`. The lattice hash is integer
  arithmetic, bit-identical in JS (`Math.imul`) and GLSL (`uint`) — `terrain.spec.js` compares the shader's land /
  sea mask (`uDebug = 1`) with `TERRAIN.land` pixel by pixel. Change a field in **both** versions.
- Derivatives (`fwidth`) only outside branches in the ground shader: every term is computed, then masked.

## Flight (`js/flight.js`, `js/squad.js`)
- `Plane`: kinematic — `dir` turns toward the commanded direction at `turnRate × rateMul` (slower until rolled in),
  `up` rolls toward the lift direction (turn + 1 g). `steer` keeps it above `FLOOR` with a 2.5 s look-ahead
  (full-rate pull-up) and below `CEIL`. Maneuvers are scripted body rates (`{ d, p, q }` segments) that take over
  `steer`; one heading for the ground is cut short. New maneuver: an entry in `MANEUVERS` with `need(plane, R)`.
- `ROUTE` moves the formation across the map (gentle turns, altitude changes); in combat it slows down (the battle
  area drifts forward), on stand-down `SQUAD.rejoin` restarts it from the flight's centroid.
- Plane modes: `form` (slot flying) · `engage` (has `target`, attack run) · `reposition` (after a shot / break,
  maneuvers) · `rejoin` (back to the slot; becomes `form` within 25 units).
  `target` ↔ `e.chasers` must always match: drop a target only through `SQUAD.release(p)`.
- Shooting: one missile per low beat (round robin among ready planes), guns on mid beats; a plane that has been
  ready for 1.6 s shoots anyway (quiet music). Friendly missiles always reach a live target; hostile ones
  (`ENEMIES.onBeat`, mid / high beats, rate-limited) always lose lock, and the target breaks and pops flares.

## Enemies (`js/enemies.js`)
- `ENEMY_TYPES[k]`: `cls` (`air` / `ground` / `sea`), `model` (key into `MODEL_DEFS`), `scale`, `hp`, `speed`, `turn`,
  `names` (labels), `w` (wave weight), `fires` (`missile` / `guns`), `alt` (air), `max` (pool size). A new kind is
  a new entry (+ a model in `MODEL_DEFS`), not new code.
- Slots are pooled per type and never disposed (each has its own line material for the fade). States:
  `live` → `struck` (red X + struck-through name, `STRUCK_T`) → `fade` (`FADE_T`) → freed. Units left more than
  `FAR_BEHIND` from `ROUTE.pos`, and air units after the fight, fade out without the X (`vanish`).
- Waves only while `AUD.fighting`, ahead of `ROUTE`: ground groups only on land, ships only at sea (tests check it).

## Performance & memory invariants (the wallpaper never restarts — leaks accumulate for days)
- **Never create geometry per spawn and drop it.** Models share `MODEL_GEO` geometry; enemy slots, bursts, missiles,
  tracers and glow particles are pools allocated once. Anything removed from the scene for good must be disposed.
- `disposeTree` skips materials with `userData.shared` (the label materials) and sprite geometry.
- Label textures are cached per (text, colour, struck) and never disposed — fine for callsigns and type names;
  don't put changing text (numbers, timers) into labels.
- Pools are ring buffers or bounded (`LINES.cap`, `GLOW.cap`, `MISSILES.N`, `TRACERS.N`, `ENEMY_TYPES[k].max`);
  spawn rates use time accumulators, never per frame.
- Baseline: ~30–90 draw calls per frame, geometries plateau (see `soak.spec.js`).

## Running & testing
- WE: "Open from File" → `project.json` (audio listener + properties come from WE).
- Browser preview: serve the folder, e.g. `python -m http.server 8765`, open `http://localhost:8765/`.
  The ⚙ SETTINGS drawer mirrors all WE properties (stored in `localStorage`); URL params `?demo=1` (demo beat),
  `?cam=fixed`, `?zoom=150`, `?ts=N` (time scale).
- **Automated tests** (`tests/`, Playwright Test in headless Chromium + SwiftShader WebGL): run them in Docker —
  `powershell -ExecutionPolicy Bypass -File tools/test.ps1 [file / -g pattern]` (no local Node; `$env:SEED = N` for
  another seed); CI runs the same image on every push / PR. Run them after a change.
  - The harness (`tests/support/harness.js`) boots the page deterministically: seeded `Math.random` (`SEED`), fixed
    date, no `requestAnimationFrame` (time only advances through `__t.sim(sec)` = `step(0.05)` per tick; `draw: true`
    also runs `draw()`), `RT()` on simulated time, Wallpaper Engine mode (audio fed by `__t.sim(sec, { audio })`).
  - `tests/support/inpage.js` (`window.__t`): `sim` runs `checkInvariants()` after every step (finite, orthonormal
    planes above the floor, known modes, target ↔ chasers, enemies on the right terrain, bounded pools, everything
    within `H.BOUND` of the origin); `forceFight` / `fightOff`; `sample` / `screen` (pixels); `geometries` (leaks);
    `groundCheck` (shader vs JS terrain); `props` (apply WE properties).
  - **When adding a mode, an enemy state or a pool**, update the sets / bounds in `inpage.js`.
  - `repo.spec.js` checks the cache-buster (all tags equal, matches "Current: `v=N`" here), the load order line
    above, that `js/properties.js` is regenerated and that every property is read in `main.js`.
  - `preview.jpg`: `$env:PREVIEW = 1; powershell -ExecutionPolicy Bypass -File tools/test.ps1 tests/preview.spec.js`
    (`$env:PREVIEW_T` = seconds of combat before the shot).
- Console checks by hand (browser): stop the loop with `frame = () => {}`, then drive it with `step(0.05)` and `draw()`;
  load `tests/support/inpage.js` with `eval(await (await fetch('/tests/support/inpage.js')).text()); __t.setup()`
  to get `__t`. Don't use `paused = true` for this — `onBeat` ignores beats while paused.

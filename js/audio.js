'use strict';
/* ===== Audio analysis (Wallpaper Engine's 128-bin spectrum), combat arming, browser demo beat =====
   Port of the Carrier Strike Group analysis: per-band energy + spectral-flux beat detection, auto-gained loudness.
   Combat is latched in updateArming() (first thing in step): sound for ARM_DELAY s → AUD.combat (= armed). When the
   sound stops, AUD.holding for DISARM_DELAY s (still armed, no new waves, no firing on the beat), then stand-down;
   sound lasting RESUME_DELAY s during the hold resumes the fight (a notification ping doesn't). */
const ARM_DELAY = 4, DISARM_DELAY = 6, RESUME_DELAY = 1;
function RT() { return performance.now() / 1000; }   // real-time clock (independent of FPS limits)
const AUD = { level: 0, lastActive: -99, soundStart: -1, raw: new Float32Array(128), demo: false, combat: false, holdUntil: 0, heavy: 0, beats: 0,
  get active() { return RT() - this.lastActive < 1.6; },
  get hot() { return this.soundStart >= 0 && this.active && RT() - this.soundStart >= ARM_DELAY; },
  get armed() { return this.combat; },
  get holding() { return this.holdUntil > 0; },
  get fighting() { return this.combat && !this.holding; } };
function updateArming() {
  if (!AUD.combat) { AUD.combat = AUD.hot; return; }
  if (AUD.active && (!AUD.holding || AUD.lastActive - AUD.soundStart >= RESUME_DELAY)) { AUD.holdUntil = 0; return; }
  if (!AUD.holding) AUD.holdUntil = RT() + DISARM_DELAY;
  else if (RT() >= AUD.holdUntil) { AUD.holdUntil = 0; AUD.combat = false; }
}
const BANDS = {
  low:  { from: 0, to: 4,   thr: 0.10, ratio: 1.35, gap: 0.2,  hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 },
  mid:  { from: 6, to: 22,  thr: 0.05, ratio: 1.30, gap: 0.12, hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 },
  high: { from: 26, to: 56, thr: 0.03, ratio: 1.30, gap: 0.10, hist: [], prev: 0, last: -9, val: 0, fh: [], peak: 0.2, norm: 0 }
};
const PREV_RAW = new Float32Array(128);
function onAudio(arr) {
  if (!ready) return;
  for (let i = 0; i < 128; i++) AUD.raw[i] = Math.min(1, arr[i] || 0);
  const sens = Math.max(0.1, CFG.sens / 100); let tot = 0;
  for (const key in BANDS) {
    const b = BANDS[key]; let e = 0, n = 0;
    for (let i = b.from; i <= b.to; i++) { e += AUD.raw[i] + AUD.raw[64 + i]; n += 2; }
    e /= n;
    let avg = e; if (b.hist.length) { avg = 0; for (const h of b.hist) avg += h; avg /= b.hist.length; }
    b.hist.push(e); if (b.hist.length > 40) b.hist.shift();
    const thr = b.thr / sens, ratio = 1 + (b.ratio - 1) / sens;
    let flux = 0;
    for (let i = b.from; i <= b.to; i++) flux += Math.max(0, AUD.raw[i] - PREV_RAW[i]) + Math.max(0, AUD.raw[64 + i] - PREV_RAW[64 + i]);
    flux /= n;
    let fm = 0, fs = 0; for (const f of b.fh) fm += f; fm /= Math.max(1, b.fh.length);
    for (const f of b.fh) fs += (f - fm) * (f - fm); fs = Math.sqrt(fs / Math.max(1, b.fh.length));
    b.fh.push(flux); if (b.fh.length > 30) b.fh.shift();
    const energyHit = e > thr && e > avg * ratio && e > b.prev * 1.04;
    const fluxHit = e > thr * 0.6 && flux > fm + fs * (1.6 / sens) && flux > 0.02 / sens;
    if ((energyHit || fluxHit) && RT() - b.last > b.gap) {
      b.last = RT(); onBeat(key, clamp(Math.max(e / Math.max(avg, 0.01), 1 + flux / Math.max(fm, 0.005) * 0.15), 1, 3));
    }
    b.peak = Math.max(e, b.peak * 0.9985, 0.05); b.norm = e / b.peak;
    b.prev = e; b.val = e; tot += e;
  }
  PREV_RAW.set(AUD.raw);
  const dense = (BANDS.mid.norm * 0.5 + BANDS.low.norm * 0.3 + BANDS.high.norm * 0.2) * smoothstep(0.03, 0.12, (BANDS.mid.val + BANDS.low.val) / 2);
  AUD.heavy += (dense - AUD.heavy) * (dense > AUD.heavy ? 0.08 : 0.02);
  AUD.level = tot / 3;
  if (AUD.level > 0.012) { if (AUD.soundStart < 0 || !AUD.active) AUD.soundStart = RT(); AUD.lastActive = RT(); }
  else if (!AUD.active) AUD.soundStart = -1;
}
/* beats drive the fight: the flight's missiles / guns, enemy fire (js/squad.js, js/enemies.js) */
function onBeat(band, strength) {
  if (!AUD.fighting || paused) return;   // no frames run while paused: anything spawned would only pile up
  AUD.beats++;
  SQUAD.onBeat(band, strength);
  ENEMIES.onBeat(band, strength);
}
/* Browser-only demo beat (controlled from the settings drawer) */
const DEMO = { on: false, bpm: 124, level: 1, pauses: true };
const FILE_AUDIO = { playing: false };           // filled in by settings.js (browser only)
function demoAudio() {
  if (FILE_AUDIO.playing) return;                   // the audio file feeds onAudio() itself
  const t = performance.now() / 1000, arr = new Array(128).fill(0);
  if (!DEMO.on) { onAudio(arr); return; }
  const beat = 60 / DEMO.bpm, ph = t % beat, bi = Math.floor(t / beat), bar = Math.floor(bi / 4) % 24;
  if (DEMO.pauses && bar >= 18) { onAudio(arr); return; } // silent bars to see the stand-down
  const kick = Math.exp(-ph * 14), snare = (bi % 2 === 1) ? Math.exp(-ph * 12) : 0, hat = Math.exp(-(t % (beat / 2)) * 30);
  for (let i = 0; i < 64; i++) {
    let v = 0.03 * Math.random();
    if (i < 6) v += 0.8 * kick; if (i >= 6 && i < 24) v += 0.55 * snare + 0.08; if (i >= 26) v += 0.35 * hat * (1 - i / 80);
    arr[i] = arr[64 + i] = v * DEMO.level;
  }
  onAudio(arr);
}

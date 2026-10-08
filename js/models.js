'use strict';
/* ===== Line-art models =====
   Every kind is built once (MODEL_GEO: line geometry + optional fill), instances are THREE.Groups sharing that
   geometry — nothing is created per spawn. Nose +Z, up +Y, ground units stand on y = 0. */

/* top-view outline of a fighter (right half, x ≥ 0; z = nose first) */
const JET_HALF = [[0, 1.6], [0.17, 0.95], [0.27, 0.35], [1.35, -0.45], [1.35, -0.72], [0.36, -0.58], [0.36, -0.88], [0.8, -1.28], [0.8, -1.45], [0.22, -1.3], [0, -1.38]];
const HEAVY_HALF = [[0, 2.6], [0.22, 2.1], [0.3, 0.9], [2.9, -0.4], [2.9, -0.75], [0.3, -0.35], [0.26, -1.8], [1.1, -2.3], [1.1, -2.55], [0.15, -2.45], [0, -2.5]];
function outlineShape(half) {
  const pts = [...half, ...half.slice(1, -1).reverse().map(q => [-q[0], q[1]])];
  const sh = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], q[1])));
  const g = new THREE.ShapeGeometry(sh); g.rotateX(Math.PI / 2);   // shape (x, y) → (x, 0, y)
  return g;
}
const MODEL_DEFS = {
  jet() {
    const s = new Seg(), o = JET_HALF.map(q => [q[0], 0, q[1]]);
    s.polyM(o, false);
    s.polyM([[0.3, 0, -0.62], [0.52, 0.62, -1.18], [0.52, 0.62, -1.38], [0.3, 0, -1.3]], false);   // canted fins
    s.poly([[0, 0, 1.6], [0, 0.22, 0.75], [0, 0.26, 0.35], [0, 0.1, -0.2]], false);                 // canopy spine
    return { lines: s.geometry(), fill: outlineShape(JET_HALF) };
  },
  heavy() {
    const s = new Seg(); s.polyM(HEAVY_HALF.map(q => [q[0], 0, q[1]]), false);
    s.poly([[0, 0, -1.6], [0, 1.0, -2.3], [0, 1.0, -2.55], [0, 0, -2.5]], false);
    for (const x of [0.95, 1.85]) for (const k of [1, -1]) s.box(k * x, -0.18, 0.2 - x * 0.35, 0.22, 0.22, 0.8);
    return { lines: s.geometry(), fill: outlineShape(HEAVY_HALF) };
  },
  heli() {
    const s = new Seg();
    s.polyM([[0, 0.3, 1.3], [0.4, 0.25, 0.8], [0.45, 0, -0.4], [0.15, 0.1, -0.9], [0.08, 0.25, -2.6], [0, 0.3, -2.7]], false);
    s.line([0, 0.3, -2.6], [0, 0.85, -2.85]);
    s.ring(0, 0.75, 0, 2.1, 20, 'y');                                                                  // rotor disc
    s.line([0, 0.35, 0], [0, 0.75, 0]);
    return { lines: s.geometry() };
  },
  sam() {
    const s = new Seg(); s.box(0, 0.45, 0, 1.4, 0.9, 3.0);
    for (const x of [-0.35, 0.35]) for (const y of [1.15, 1.6]) s.line([x, y - 0.3, -0.9], [x, y + 0.5, 1.2]);
    return { lines: s.geometry() };
  },
  aagun() {
    const s = new Seg(); s.box(0, 0.35, 0, 1.8, 0.7, 1.8).box(0, 1.0, 0, 1.0, 0.6, 1.0);
    for (const x of [-0.2, 0.2]) s.line([x, 1.1, 0.5], [x, 2.2, 1.9]);
    return { lines: s.geometry() };
  },
  tank() {
    const s = new Seg(); s.box(0, 0.4, 0, 1.7, 0.8, 3.0).box(0, 1.05, -0.2, 1.1, 0.5, 1.4).line([0, 1.05, 0.5], [0, 1.1, 2.4]);
    return { lines: s.geometry() };
  },
  radar() {
    const s = new Seg(); s.box(0, 0.5, 0, 1.6, 1.0, 1.6).line([0, 1.0, 0], [0, 2.6, 0]);
    const arc = []; for (let i = 0; i <= 8; i++) { const a = (i / 8 - 0.5) * 2.2; arc.push([Math.sin(a) * 1.6, 2.6 + (1 - Math.cos(a)) * 0.6, (1 - Math.cos(a)) * 0.8]); }
    s.poly(arc, false); s.line(arc[0], arc[8]);
    return { lines: s.geometry() };
  },
  frigate() { return ship(14, 2.4); },
  destroyer() { return ship(20, 3.0); }
};
function ship(L, B) {
  const s = new Seg(), h = L / 2, w = B / 2;
  const deck = [[0, 0.6, h], [w * 0.8, 0.6, h * 0.55], [w, 0.6, 0], [w * 0.9, 0.6, -h * 0.85], [w * 0.6, 0.6, -h]];
  s.polyM(deck, false); s.line(deck[4], [-deck[4][0], 0.6, -h]);
  s.polyM(deck.map(q => [q[0] * 0.9, 0, q[2] * 0.95]), false);
  s.box(0, 1.4, h * 0.1, B * 0.5, 1.6, L * 0.22).box(0, 1.2, -h * 0.45, B * 0.45, 1.2, L * 0.15).line([0, 2.2, h * 0.1], [0, 4.2, h * 0.05]);
  s.line([0, 0.9, h * 0.6], [0, 1.0, h * 0.85]);   // gun
  return { lines: s.geometry() };
}
const MODEL_GEO = {};
function modelGeo(kind) { return MODEL_GEO[kind] || (MODEL_GEO[kind] = MODEL_DEFS[kind]()); }

/* one instance: { group, lineMat, fillMat } — materials are the caller's (shared for the flight, per pool slot for enemies) */
function buildModel(kind, lineMat, fillMat, scale) {
  const g = modelGeo(kind), group = new THREE.Group();
  const ln = new THREE.LineSegments(g.lines, lineMat); group.add(ln);
  if (g.fill && fillMat) { const f = new THREE.Mesh(g.fill, fillMat); f.renderOrder = -1; group.add(f); }
  group.scale.setScalar(scale || 1);
  return group;
}
const lineMaterial = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity == null ? 1 : opacity, depthWrite: false, blending: THREE.AdditiveBlending });
const fillMaterial = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });

'use strict';
/* ===== Schematic glyphs (the replay screen's symbols, not models) =====
   A glyph is a list of line segments in local units: nose / forward +Z, up +Y, x to the side. Aircraft glyphs are
   drawn in the aircraft's attitude (they bank and pitch with it); ground and sea markers lie flat on the ground,
   turned to the unit's heading. Everything is drawn every frame through LINES (glowing, constant pixel width) — there
   are no meshes, so nothing to pool or dispose per unit. */
function glyph(build) { const s = new Seg(); build(s); return new Float32Array(s.p); }
const flatPoly = (s, pts) => s.poly(pts.map(q => [q[0], 0, q[1]]), true);
const GLYPHS = {
  // fighter: an arrowhead with a spine and a small fin
  arrow: glyph(s => { flatPoly(s, [[0, 1.8], [1.25, -1.2], [0, -0.45], [-1.25, -1.2]]); s.line([0, 0, -0.45], [0, 0, 1.05]).line([0, 0, -0.45], [0, 0.55, -0.95]); }),
  // bomber / transport: fuselage, straight-ish wings, tail
  heavy: glyph(s => { s.line([0, 0, 2.3], [0, 0, -2.2]).poly([[-2.5, 0, -0.3], [0, 0, 0.9], [2.5, 0, -0.3]], false).poly([[-0.95, 0, -2.2], [0, 0, -1.55], [0.95, 0, -2.2]], false).line([0, 0, -1.7], [0, 0.6, -2.2]); }),
  // AWACS: the heavy with a radome
  awacs: glyph(s => { s.line([0, 0, 2.3], [0, 0, -2.2]).poly([[-2.5, 0, -0.3], [0, 0, 0.9], [2.5, 0, -0.3]], false).poly([[-0.95, 0, -2.2], [0, 0, -1.55], [0.95, 0, -2.2]], false).ring(0, 0.35, -0.6, 0.8, 14, 'y'); }),
  // helicopter: rotor disc and tail boom
  heli: glyph(s => { s.ring(0, 0.25, 0.2, 1.5, 16, 'y').line([0, 0.25, -0.2], [0, 0.25, -2.4]).line([-0.5, 0.25, -2.4], [0.5, 0.25, -2.4]); }),
  // ground markers (flat)
  sam: glyph(s => flatPoly(s, [[-1, -0.6], [0.4, -0.6], [1, 0.6], [-0.4, 0.6]])),
  aagun: glyph(s => { flatPoly(s, [[-0.75, -0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, 0.75]]); s.line([-0.75, 0, -0.75], [0.75, 0, 0.75]).line([0.75, 0, -0.75], [-0.75, 0, 0.75]); }),
  tank: glyph(s => flatPoly(s, [[-0.8, -1], [0.8, -1], [0.8, 0.35], [0, 1.15], [-0.8, 0.35]])),
  radar: glyph(s => { s.ring(0, 0, 0, 0.95, 14, 'y').line([0, 0, 0], [0.55, 0, 0.55]); }),
  hq: glyph(s => { flatPoly(s, [[-1, -1], [1, -1], [1, 1], [-1, 1]]); flatPoly(s, [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]); }),
  // ships: a hull outline along the heading
  ship: glyph(s => flatPoly(s, [[0, 2.2], [0.75, 1.0], [0.75, -1.7], [0.45, -2.2], [-0.45, -2.2], [-0.75, -1.7], [-0.75, 1.0]])),
  carrier: glyph(s => { flatPoly(s, [[0, 2.6], [0.9, 1.8], [1.1, -2.6], [-0.9, -2.6], [-0.9, 1.8]]); s.line([-0.6, 0, -2.2], [0.5, 0, 1.4]).line([0.95, 0, -0.4], [0.95, 0, 0.6]); })
};

/* draw a glyph at pos, oriented by fwd (+Z) / up (+Y), scaled, into LINES */
const _glR = new V3(), _glF = new V3(), _glU = new V3();
function drawGlyph(g, pos, fwd, up, scale, c, a, w) {
  _glR.crossVectors(up, fwd).multiplyScalar(scale); _glF.copy(fwd).multiplyScalar(scale); _glU.copy(up).multiplyScalar(scale);
  const R = _glR, F = _glF, U = _glU, px = pos.x, py = pos.y, pz = pos.z;
  for (let i = 0; i < g.length; i += 6) {
    const x0 = g[i], y0 = g[i + 1], z0 = g[i + 2], x1 = g[i + 3], y1 = g[i + 4], z1 = g[i + 5];
    LINES.add(px + R.x * x0 + U.x * y0 + F.x * z0, py + R.y * x0 + U.y * y0 + F.y * z0, pz + R.z * x0 + U.z * y0 + F.z * z0,
      px + R.x * x1 + U.x * y1 + F.x * z1, py + R.y * x1 + U.y * y1 + F.y * z1, pz + R.z * x1 + U.z * y1 + F.z * z1, c, a, a, w);
  }
}
/* a ground / sea marker lying flat at height y, turned to heading h */
const _hf = new V3(), _hp = new V3();
function drawMarker(g, x, z, h, scale, c, a, w) { _hf.set(Math.sin(h), 0, Math.cos(h)); drawGlyph(g, _hp.set(x, 0.15, z), _hf, UP, scale, c, a, w); }

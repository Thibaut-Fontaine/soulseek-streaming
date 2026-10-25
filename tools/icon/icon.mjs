// SoulStream app icon: a play button drawn by three connected peers.
// Single source for every icon asset; run `node tools/icon/generate.mjs`.
//
// Design notes:
// - Amber background: no major music app uses it (Spotify green, Apple
//   Music / YouTube Music red, SoundCloud orange, Deezer purple, Shazam blue,
//   Tidal black), and a near-black glyph on it has the highest contrast.
// - Optical centring: two of the three peers sit on the left, so centring the
//   bounding box makes the glyph look shifted left. The glyph is moved 80 % of
//   the way from its box centre to its centre of mass horizontally (50 %
//   vertically, which is already symmetric).

/** Glyph in a 100-unit design space. */
export const GLYPH = {
  triangle: { points: [[37, 29], [37, 71], [73, 50]], strokeWidth: 7 },
  nodeRadius: 9,
};

export const COLORS = {
  glyph: '#17120A',
  /** Background gradient, top-left to bottom-right. */
  bgStart: '#FFC94A',
  bgEnd: '#FF9A1F',
  /** Flat colour where a gradient is not possible. */
  bgFlat: '#FFB02E',
};

/** Largest side of the glyph, in % of the visible icon. */
export const GLYPH_SIZE = 58;
export const OPTICAL = { x: 0.8, y: 0.5 };

export function glyphSvg(color) {
  const [a, b, c] = GLYPH.triangle.points;
  const r = GLYPH.nodeRadius;
  return (
    `<path d="M${a} L${b} L${c} Z" fill="none" stroke="${color}" stroke-width="${GLYPH.triangle.strokeWidth}" stroke-linejoin="round"/>` +
    GLYPH.triangle.points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`).join('')
  );
}

/** Path data of the glyph's nodes, for Android vector drawables. */
export function nodesPathData() {
  const r = GLYPH.nodeRadius;
  return GLYPH.triangle.points
    .map(([x, y]) => `M${x - r},${y} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`)
    .join(' ');
}

export function trianglePathData() {
  const [a, b, c] = GLYPH.triangle.points;
  return `M${a} L${b} L${c} Z`;
}

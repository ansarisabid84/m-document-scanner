import type { Point, Quad } from './models';

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function inset(quad: Quad, amount: number): Quad {
  const c = centroid(quad);
  return quad.map((p) => ({ x: p.x + (c.x - p.x) * amount, y: p.y + (c.y - p.y) * amount })) as Quad;
}

export function centroid(pts: Point[]): Point {
  const s = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / pts.length, y: s.y / pts.length };
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed polygon area (shoelace). Positive for clockwise in screen coordinates (y down). */
export function polygonArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Orders 4 arbitrary points as TL, TR, BR, BL. */
export function orderQuad(pts: Point[]): Quad {
  if (pts.length !== 4) throw new Error('orderQuad needs exactly 4 points');
  const c = centroid(pts);
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // Angle-sorted from -PI: starts near left/top-left going clockwise (y down). Rotate so TL (min x+y) is first.
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const s = p.x + p.y;
    if (s < best) {
      best = s;
      start = i;
    }
  });
  const q = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  return [q[0], q[1], q[2], q[3]];
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function isConvex(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]);
    if (Math.abs(c) < 1e-9) return false;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Interior angles in degrees. */
export function quadAngles(quad: Quad): number[] {
  return quad.map((p, i) => {
    const prev = quad[(i + 3) % 4];
    const next = quad[(i + 1) % 4];
    const a = { x: prev.x - p.x, y: prev.y - p.y };
    const b = { x: next.x - p.x, y: next.y - p.y };
    const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

/** Whether a user-adjusted quad is usable for warping. */
export function isUsableQuad(quad: Quad, minArea = 0.01): boolean {
  if (!isConvex(quad)) return false;
  if (Math.abs(polygonArea(quad)) < minArea) return false;
  return quadAngles(quad).every((a) => a > 15 && a < 165);
}

/** Output size in pixels for a perspective-corrected quad on an image of (w,h). */
export function warpedSize(quad: Quad, w: number, h: number, maxDim: number): { width: number; height: number } {
  const px = quad.map((p) => ({ x: p.x * w, y: p.y * h }));
  let width = Math.max(dist(px[0], px[1]), dist(px[3], px[2]));
  let height = Math.max(dist(px[0], px[3]), dist(px[1], px[2]));
  const scale = Math.min(1, maxDim / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  return { width, height };
}

/** Solves A x = b for an n x n system using Gaussian elimination with partial pivoting. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('Singular matrix');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Homography H (row-major 3x3, h33 = 1) mapping each src point to the matching dst point.
 */
export function homography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [...h, 1];
}

export function applyHomography(H: number[], p: Point): Point {
  const d = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d };
}

/** Rotates a normalised quad together with an image rotated by `deg` clockwise. */
export function rotatePointNorm(p: Point, deg: number): Point {
  switch (((deg % 360) + 360) % 360) {
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
    default:
      return p;
  }
}

export function clampQuad(q: Quad): Quad {
  return q.map((p) => ({ x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) })) as Quad;
}

/** Mean corner distance between two quads (normalised units). */
export function quadDelta(a: Quad, b: Quad): number {
  return a.reduce((s, p, i) => s + dist(p, b[i]), 0) / 4;
}

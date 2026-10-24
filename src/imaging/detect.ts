import type { Point, Quad } from '../domain/models';
import { inset, isConvex, orderQuad, polygonArea, quadAngles } from '../domain/geometry';

/**
 * Lightweight document boundary detector (no OpenCV dependency).
 * Works on a small greyscale frame (~256–360 px on the long edge):
 *   1. blur → Sobel gradient → Otsu threshold → dilate        (edge candidate)
 *   2. blur → Otsu on brightness → largest bright region      (paper-on-background candidate)
 *   3. convex hull of each candidate → best inscribed quadrilateral
 *   4. score by how well the quad's perimeter lies on real edges ("edge support")
 * Returns null when nothing convincing is found, so the UI can fall back to manual crop.
 */

export interface Detection {
  quad: Quad; // normalised 0..1
  confidence: number; // 0..1
}

export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

export function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  const d = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / d;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / d;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

export function otsu(values: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

function sobel(g: Uint8Array, w: number, h: number): Uint8Array {
  const mag = new Float32Array(w * h);
  let max = 1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const m = Math.abs(gx) + Math.abs(gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, (mag[i] / max) * 255 * 2);
  return out;
}

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && mask[yy * w + xx]) {
            v = 1;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Returns point lists of the largest connected components (8-connected) by bounding-box area. */
function components(mask: Uint8Array, w: number, h: number, keep = 4): Point[][] {
  const label = new Int32Array(w * h);
  const comps: { pts: Point[]; bbox: number }[] = [];
  const stack: number[] = [];
  let id = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    id++;
    label[s] = id;
    stack.push(s);
    const pts: Point[] = [];
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      pts.push({ x, y });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !label[j]) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
    }
    comps.push({ pts, bbox: (maxX - minX + 1) * (maxY - minY + 1) });
  }
  return comps
    .sort((a, b) => b.bbox - a.bbox)
    .slice(0, keep)
    .map((c) => c.pts);
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();
  // Reduce: keep only extreme x per row, which is enough for the hull and much faster.
  const rows = new Map<number, { min: Point; max: Point }>();
  for (const p of points) {
    const r = rows.get(p.y);
    if (!r) rows.set(p.y, { min: p, max: p });
    else {
      if (p.x < r.min.x) r.min = p;
      if (p.x > r.max.x) r.max = p;
    }
  }
  const pts: Point[] = [];
  rows.forEach((r) => {
    pts.push(r.min);
    if (r.max !== r.min) pts.push(r.max);
  });
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/** Simplifies a closed polygon by repeatedly dropping the vertex that contributes least. */
function simplifyClosed(poly: Point[], target: number): Point[] {
  const pts = poly.slice();
  while (pts.length > target) {
    let minI = 0;
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = perpDist(pts[i], pts[(i - 1 + pts.length) % pts.length], pts[(i + 1) % pts.length]);
      if (d < minD) {
        minD = d;
        minI = i;
      }
    }
    pts.splice(minI, 1);
  }
  return pts;
}

/** Largest-area quadrilateral using vertices of the (simplified) hull. */
export function bestQuadFromHull(hull: Point[]): Point[] | null {
  if (hull.length < 4) return null;
  const pts = simplifyClosed(hull, Math.min(hull.length, 10));
  let best: Point[] | null = null;
  let bestA = 0;
  const n = pts.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const q = [pts[a], pts[b], pts[c], pts[d]];
          const area = Math.abs(polygonArea(q));
          if (area > bestA) {
            bestA = area;
            best = q;
          }
        }
  return best;
}

/** Fraction of perimeter samples that land on (or right next to) edge pixels. */
function edgeSupport(quad: Point[], edges: Uint8Array, w: number, h: number): number {
  let hit = 0;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(8, Math.floor(len / 2));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      total++;
      let found = false;
      for (let dy = -2; dy <= 2 && !found; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && edges[yy * w + xx]) {
            found = true;
            break;
          }
        }
      if (found) hit++;
    }
  }
  return total ? hit / total : 0;
}

export function detectDocument(rgba: Uint8ClampedArray, w: number, h: number): Detection | null {
  const gray = toGray(rgba, w, h);
  const blurred = boxBlur(boxBlur(gray, w, h, 2), w, h, 1);
  const grad = sobel(blurred, w, h);
  const gt = Math.max(28, otsu(grad));
  const edgeMask = new Uint8Array(w * h);
  for (let i = 0; i < grad.length; i++) edgeMask[i] = grad[i] > gt ? 1 : 0;
  // Ignore a 2px frame border where Sobel is undefined.
  for (let x = 0; x < w; x++) {
    edgeMask[x] = edgeMask[w + x] = edgeMask[(h - 1) * w + x] = edgeMask[(h - 2) * w + x] = 0;
  }
  for (let y = 0; y < h; y++) {
    edgeMask[y * w] = edgeMask[y * w + 1] = edgeMask[y * w + w - 1] = edgeMask[y * w + w - 2] = 0;
  }
  const edgesD = dilate(edgeMask, w, h);

  const candidates: Point[][] = [];
  for (const comp of components(edgesD, w, h, 3)) {
    const q = bestQuadFromHull(convexHull(comp));
    if (q) candidates.push(q);
  }
  // Brightness segmentation: paper is usually lighter than its background.
  const bt = otsu(blurred);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < bright.length; i++) bright[i] = blurred[i] > bt ? 1 : 0;
  for (const comp of components(bright, w, h, 2)) {
    const q = bestQuadFromHull(convexHull(comp));
    if (q) candidates.push(q);
  }

  const frameArea = w * h;
  let best: { quad: Point[]; score: number; support: number } | null = null;
  for (const raw of candidates) {
    const q = orderQuad(raw);
    const area = Math.abs(polygonArea(q)) / frameArea;
    if (area < 0.12 || area > 0.995) continue;
    if (!isConvex(q)) continue;
    const angles = quadAngles(q);
    if (angles.some((a) => a < 50 || a > 130)) continue;
    const minSide = Math.min(...q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y)));
    if (minSide < Math.min(w, h) * 0.15) continue;
    const support = edgeSupport(q, edgesD, w, h);
    const angleRegularity = 1 - angles.reduce((s, a) => s + Math.abs(90 - a), 0) / (4 * 40);
    const score = support * 0.7 + Math.min(1, area / 0.5) * 0.15 + angleRegularity * 0.15;
    if (!best || score > best.score) best = { quad: q, score, support };
  }
  if (!best || best.support < 0.45) return null;
  // Edges are found on a blurred, dilated mask, so the hull sits ~1–2px outside the paper; pull it in slightly.
  const quad = inset(
    best.quad.map((p) => ({ x: Math.min(1, Math.max(0, p.x / (w - 1))), y: Math.min(1, Math.max(0, p.y / (h - 1))) })) as Quad,
    0.022,
  );
  return { quad, confidence: Math.max(0, Math.min(1, best.score)) };
}

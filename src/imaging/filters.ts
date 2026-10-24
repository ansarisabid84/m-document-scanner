import type { FilterType } from '../domain/models';
import type { RGBAImage } from './warp';

/**
 * Document enhancement filters. All operate in place on RGBA pixel data and are deterministic.
 * "Auto"/"Color" keep natural colours while flattening uneven lighting (shadow/vignette removal),
 * "Grayscale" and "B & W" target readability and small file size.
 */

function luminance(d: Uint8ClampedArray, n: number): Uint8Array {
  const L = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) L[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return L;
}

function percentile(L: Uint8Array, p: number, step = 7): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < L.length; i += step) {
    hist[L[i]]++;
    n++;
  }
  const target = n * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** Estimates the paper/background brightness at every pixel (bilinear-upsampled coarse grid). */
export function backgroundMap(L: Uint8Array, w: number, h: number): Float32Array {
  const cell = Math.max(12, Math.round(Math.max(w, h) / 36));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Float32Array(gw * gh);
  const global = percentile(L, 0.9);
  const floor = Math.max(40, global * 0.55);
  const hist = new Uint16Array(64);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      let n = 0;
      const y1 = Math.min(h, (gy + 1) * cell);
      const x1 = Math.min(w, (gx + 1) * cell);
      for (let y = gy * cell; y < y1; y += 2) {
        for (let x = gx * cell; x < x1; x += 2) {
          hist[L[y * w + x] >> 2]++;
          n++;
        }
      }
      const target = n * 0.9;
      let acc = 0;
      let v = 63;
      for (let b = 0; b < 64; b++) {
        acc += hist[b];
        if (acc >= target) {
          v = b;
          break;
        }
      }
      grid[gy * gw + gx] = Math.max(floor, v * 4 + 2);
    }
  }
  // Smooth the grid twice so the map has no blocky steps.
  for (let pass = 0; pass < 2; pass++) {
    const copy = grid.slice();
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = gy + dy;
            const xx = gx + dx;
            if (yy >= 0 && xx >= 0 && yy < gh && xx < gw) {
              s += copy[yy * gw + xx];
              c++;
            }
          }
        grid[gy * gw + gx] = s / c;
      }
  }
  const bg = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx;
      const bot = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
      bg[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return bg;
}

function normalizeIllumination(img: RGBAImage, saturation: number, strength: number): void {
  const { data: d, width: w, height: h } = img;
  const n = w * h;
  const L = luminance(d, n);
  const bg = backgroundMap(L, w, h);
  // Normalise then find black point for contrast stretching.
  const normL = new Uint8Array(n);
  for (let i = 0; i < n; i++) normL[i] = Math.min(255, (L[i] * 255) / bg[i]);
  const black = Math.min(140, percentile(normL, 0.02));
  const white = 245;
  const range = Math.max(1, white - black);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const k = 255 / bg[i];
    let r = d[j] * k;
    let g = d[j + 1] * k;
    let b = d[j + 2] * k;
    r = ((r - black) * 255) / range;
    g = ((g - black) * 255) / range;
    b = ((b - black) * 255) / range;
    if (saturation !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;
    }
    // Blend with the original to keep a natural look ("strength" < 1).
    d[j] = d[j] + (r - d[j]) * strength;
    d[j + 1] = d[j + 1] + (g - d[j + 1]) * strength;
    d[j + 2] = d[j + 2] + (b - d[j + 2]) * strength;
  }
}

function toGrayscale(img: RGBAImage, enhance: boolean): void {
  const { data: d, width: w, height: h } = img;
  const n = w * h;
  const L = luminance(d, n);
  let out = L;
  if (enhance) {
    const bg = backgroundMap(L, w, h);
    out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.min(255, (L[i] * 255) / bg[i]);
    const black = Math.min(140, percentile(out, 0.02));
    const range = Math.max(1, 248 - black);
    for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, ((out[i] - black) * 255) / range));
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) d[j] = d[j + 1] = d[j + 2] = out[i];
}

/** Bradley–Roth adaptive threshold on the illumination-normalised luminance. */
function toBlackWhite(img: RGBAImage): void {
  const { data: d, width: w, height: h } = img;
  const n = w * h;
  const L = luminance(d, n);
  const bg = backgroundMap(L, w, h);
  const N = new Uint8Array(n);
  for (let i = 0; i < n; i++) N[i] = Math.min(255, (L[i] * 255) / bg[i]);
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += N[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const s = Math.max(8, Math.round(Math.max(w, h) / 24));
  const half = s >> 1;
  const T = 0.16;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const v = N[y * w + x];
      // Dark pixels below the local mean (with margin) become ink; also force very dark pixels to ink.
      const ink = v * count < sum * (1 - T) || v < 70;
      const o = (y * w + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = ink ? 0 : 255;
    }
  }
}

/** brightness, contrast in -100..100 */
export function adjust(img: RGBAImage, brightness: number, contrast: number): void {
  if (!brightness && !contrast) return;
  const c = (contrast / 100) * 128;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  const b = (brightness / 100) * 96;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = f * (v - 128) + 128 + b;
  const d = img.data;
  for (let j = 0; j < d.length; j += 4) {
    d[j] = lut[d[j]];
    d[j + 1] = lut[d[j + 1]];
    d[j + 2] = lut[d[j + 2]];
  }
}

export function applyFilter(img: RGBAImage, filter: FilterType): void {
  switch (filter) {
    case 'auto':
      normalizeIllumination(img, 1.05, 0.9);
      break;
    case 'color':
      normalizeIllumination(img, 1.35, 1);
      break;
    case 'grayscale':
      toGrayscale(img, true);
      break;
    case 'bw':
      toBlackWhite(img);
      break;
    case 'original':
    default:
      break;
  }
}

/** Export-time colour conversion (independent of the page's own filter). */
export function applyColorMode(img: RGBAImage, mode: 'as-is' | 'grayscale' | 'bw'): void {
  if (mode === 'grayscale') toGrayscale(img, false);
  else if (mode === 'bw') toBlackWhite(img);
}

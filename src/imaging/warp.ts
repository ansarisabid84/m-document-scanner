import type { Quad, Rotation } from '../domain/models';
import { homography, warpedSize } from '../domain/geometry';

export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Perspective-corrects `quad` (normalised) of `src` into a rectangle no larger than maxDim on its long edge. */
export function warpPerspective(src: RGBAImage, quad: Quad, maxDim: number): RGBAImage {
  const { width: ow, height: oh } = warpedSize(quad, src.width, src.height, maxDim);
  const srcPts = quad.map((p) => ({ x: p.x * (src.width - 1), y: p.y * (src.height - 1) }));
  const dstPts = [
    { x: 0, y: 0 },
    { x: ow - 1, y: 0 },
    { x: ow - 1, y: oh - 1 },
    { x: 0, y: oh - 1 },
  ];
  // Inverse mapping: for each output pixel find the source location.
  const H = homography(dstPts, srcPts);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  for (let y = 0; y < oh; y++) {
    // Incremental evaluation of the projective transform along the row.
    let nx = H[1] * y + H[2];
    let ny = H[4] * y + H[5];
    let d = H[7] * y + H[8];
    let o = y * ow * 4;
    for (let x = 0; x < ow; x++) {
      const fx = nx / d;
      const fy = ny / d;
      nx += H[0];
      ny += H[3];
      d += H[6];
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) {
        const cx = Math.min(sw - 1, Math.max(0, Math.round(fx)));
        const cy = Math.min(sh - 1, Math.max(0, Math.round(fy)));
        const i = (cy * sw + cx) * 4;
        out[o] = s[i];
        out[o + 1] = s[i + 1];
        out[o + 2] = s[i + 2];
        out[o + 3] = 255;
        o += 4;
        continue;
      }
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      out[o] = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
      out[o + 1] = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
      out[o + 2] = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
      out[o + 3] = 255;
      o += 4;
    }
  }
  return { data: out, width: ow, height: oh };
}

/** Rotates clockwise by a multiple of 90°. */
export function rotate90(img: RGBAImage, rotation: Rotation): RGBAImage {
  if (rotation === 0) return img;
  const { width: w, height: h, data } = img;
  const ow = rotation === 180 ? w : h;
  const oh = rotation === 180 ? h : w;
  const src32 = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const dst32 = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (rotation === 90) {
        nx = h - 1 - y;
        ny = x;
      } else if (rotation === 180) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      dst32[ny * ow + nx] = src32[y * w + x];
    }
  }
  return { data: out, width: ow, height: oh };
}

/** Area-averaging downscale (good quality for large reductions). */
export function downscale(img: RGBAImage, maxDim: number): RGBAImage {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) return img;
  const ow = Math.max(1, Math.round(img.width * scale));
  const oh = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(ow * oh * 4);
  const sx = img.width / ow;
  const sy = img.height / oh;
  for (let y = 0; y < oh; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < ow; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const o = (y * ow + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: ow, height: oh };
}

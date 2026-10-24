import { describe, expect, it } from 'vitest';
import { detectDocument } from '../imaging/detect';
import { applyFilter, adjust } from '../imaging/filters';
import { rotate90, warpPerspective, downscale } from '../imaging/warp';
import { cooldownFor, shouldRelock } from '../domain/lockPolicy';

/** Renders a filled convex polygon (light paper with dark text lines) on a dark textured background. */
function synthetic(w: number, h: number, quad: [number, number][]) {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = quad[i];
      const [bx, by] = quad[(i + 1) % 4];
      const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      const s = Math.sign(c);
      if (s === 0) continue;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let v = 60 + ((x * 7 + y * 13) % 17); // wood-ish background
      if (inside(x, y)) v = y % 12 < 2 && x % 40 > 6 ? 70 : 230;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  return data;
}

describe('document detection', () => {
  it('finds a tilted page on a dark background', () => {
    const w = 320;
    const h = 240;
    const truth: [number, number][] = [[70, 30], [250, 45], [240, 215], [60, 200]];
    const det = detectDocument(synthetic(w, h, truth), w, h);
    expect(det).not.toBeNull();
    det!.quad.forEach((p, i) => {
      expect(Math.abs(p.x * (w - 1) - truth[i][0])).toBeLessThan(7);
      expect(Math.abs(p.y * (h - 1) - truth[i][1])).toBeLessThan(7);
    });
    expect(det!.confidence).toBeGreaterThan(0.5);
  });

  it('returns null for an empty, featureless frame', () => {
    const w = 200;
    const h = 150;
    const data = new Uint8ClampedArray(w * h * 4).fill(128);
    expect(detectDocument(data, w, h)).toBeNull();
  });
});

describe('warp and filters', () => {
  it('warps a full-frame quad to the same size and rotates', () => {
    const img = { data: new Uint8ClampedArray(40 * 20 * 4).fill(200), width: 40, height: 20 };
    const out = warpPerspective(img, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 4000);
    expect(out.width).toBe(40);
    expect(out.height).toBe(20);
    const r = rotate90(out, 90);
    expect([r.width, r.height]).toEqual([20, 40]);
    const d = downscale({ data: new Uint8ClampedArray(100 * 50 * 4), width: 100, height: 50 }, 20);
    expect([d.width, d.height]).toEqual([20, 10]);
  });

  it('B&W filter produces only black and white pixels', () => {
    const w = 64;
    const h = 64;
    const data = synthetic(w, h, [[0, 0], [63, 0], [63, 63], [0, 63]]);
    const img = { data, width: w, height: h };
    applyFilter(img, 'bw');
    for (let i = 0; i < data.length; i += 4) expect([0, 255]).toContain(data[i]);
  });

  it('auto filter whitens uneven paper background', () => {
    const w = 120;
    const h = 120;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const shade = 140 + Math.round((x / w) * 80); // shadow on the left
        data[o] = data[o + 1] = data[o + 2] = shade;
        data[o + 3] = 255;
      }
    applyFilter({ data, width: w, height: h }, 'auto');
    const left = data[(60 * w + 5) * 4];
    const right = data[(60 * w + 115) * 4];
    expect(Math.abs(left - right)).toBeLessThan(30);
    expect(left).toBeGreaterThan(200);
  });

  it('brightness raises values', () => {
    const img = { data: new Uint8ClampedArray([100, 100, 100, 255]), width: 1, height: 1 };
    adjust(img, 50, 0);
    expect(img.data[0]).toBeGreaterThan(100);
  });

  it('lock cooldown escalates after five failures', () => {
    expect(cooldownFor(4)).toBe(0);
    expect(cooldownFor(5)).toBe(30_000);
    expect(cooldownFor(6)).toBe(60_000);
    expect(cooldownFor(50)).toBe(15 * 60_000);
    expect(shouldRelock(true, 31_000, 30)).toBe(true);
    expect(shouldRelock(true, 5_000, 30)).toBe(false);
    expect(shouldRelock(false, 999_999, 0)).toBe(false);
  });
});

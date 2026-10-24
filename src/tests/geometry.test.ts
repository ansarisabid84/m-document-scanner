import { describe, expect, it } from 'vitest';
import { applyHomography, homography, isConvex, isUsableQuad, orderQuad, polygonArea, rotatePointNorm, warpedSize } from '../domain/geometry';
import type { Quad } from '../domain/models';

describe('geometry', () => {
  it('orders shuffled corners as TL, TR, BR, BL', () => {
    const q = orderQuad([
      { x: 0.9, y: 0.95 },
      { x: 0.1, y: 0.05 },
      { x: 0.05, y: 0.9 },
      { x: 0.95, y: 0.1 },
    ]);
    expect(q[0]).toEqual({ x: 0.1, y: 0.05 });
    expect(q[1]).toEqual({ x: 0.95, y: 0.1 });
    expect(q[2]).toEqual({ x: 0.9, y: 0.95 });
    expect(q[3]).toEqual({ x: 0.05, y: 0.9 });
  });

  it('computes a homography that maps corners exactly', () => {
    const src = [
      { x: 10, y: 20 },
      { x: 300, y: 5 },
      { x: 320, y: 400 },
      { x: 0, y: 380 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 140 },
      { x: 0, y: 140 },
    ];
    const H = homography(src, dst);
    src.forEach((p, i) => {
      const r = applyHomography(H, p);
      expect(r.x).toBeCloseTo(dst[i].x, 6);
      expect(r.y).toBeCloseTo(dst[i].y, 6);
    });
  });

  it('detects convexity and usable quads', () => {
    const good: Quad = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
    const bowtie: Quad = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.9 }];
    expect(isConvex(good)).toBe(true);
    expect(isUsableQuad(good)).toBe(true);
    expect(isConvex(bowtie)).toBe(false);
    expect(isUsableQuad(bowtie)).toBe(false);
    expect(Math.abs(polygonArea(good))).toBeCloseTo(0.64);
  });

  it('computes warped output size capped by maxDim', () => {
    const q: Quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(warpedSize(q, 2000, 3000, 1500)).toEqual({ width: 1000, height: 1500 });
  });

  it('rotates normalised points clockwise', () => {
    expect(rotatePointNorm({ x: 0, y: 0 }, 90)).toEqual({ x: 1, y: 0 });
    expect(rotatePointNorm({ x: 1, y: 0 }, 180)).toEqual({ x: 0, y: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { estimateExportBytes, fitToPage, parsePageRange, validateExport } from '../domain/exportOptions';

describe('export options', () => {
  it('parses page ranges', () => {
    expect(parsePageRange('', 3)).toEqual([0, 1, 2]);
    expect(parsePageRange('1-2, 4', 5)).toEqual([0, 1, 3]);
    expect(parsePageRange('3-', 5)).toEqual([2, 3, 4]);
    expect(parsePageRange('2,2,1', 5)).toEqual([0, 1]);
    expect(parsePageRange('0', 5)).toBeNull();
    expect(parsePageRange('4-2', 5)).toBeNull();
    expect(parsePageRange('9', 5)).toBeNull();
    expect(parsePageRange('abc', 5)).toBeNull();
  });
  it('validates options', () => {
    const base = { format: 'pdf' as const, quality: 'balanced' as const, pageSize: 'a4' as const, colorMode: 'as-is' as const, ocrLayer: true, range: '', fileName: 'x' };
    expect(validateExport(base, 2)).toBeNull();
    expect(validateExport({ ...base, fileName: ' ' }, 2)).toMatch(/file name/);
    expect(validateExport({ ...base, range: '5' }, 2)).toMatch(/range/);
    expect(validateExport(base, 0)).toMatch(/no pages/);
  });
  it('fits images preserving aspect', () => {
    const r = fitToPage(1000, 2000, 600, 600);
    expect(r.w).toBeCloseTo(300);
    expect(r.h).toBeCloseTo(600);
    expect(r.x).toBeCloseTo(150);
  });
  it('estimates smaller output for smaller presets', () => {
    const pages = [{ outWidth: 2400, outHeight: 3400 }];
    const base = { format: 'pdf' as const, pageSize: 'a4' as const, colorMode: 'as-is' as const, ocrLayer: false, range: '', fileName: 'x' };
    expect(estimateExportBytes({ ...base, quality: 'small' }, pages)).toBeLessThan(estimateExportBytes({ ...base, quality: 'high' }, pages));
  });
});

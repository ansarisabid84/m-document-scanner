import { describe, expect, it } from 'vitest';
import { cleanTitle, formatBytes, safeFileName, suggestTitle, uniqueTitle } from '../domain/naming';

describe('naming', () => {
  it('suggests a dated title', () => {
    expect(suggestTitle(new Date(2026, 9, 18, 9, 5))).toBe('Scan 18 Oct 2026, 09:05');
  });
  it('cleans titles and falls back when empty', () => {
    expect(cleanTitle('  Tax \n  return  ', 'x')).toBe('Tax return');
    expect(cleanTitle('   ', 'Fallback')).toBe('Fallback');
  });
  it('makes titles unique case-insensitively', () => {
    expect(uniqueTitle('Invoice', ['invoice'])).toBe('Invoice (2)');
    expect(uniqueTitle('Invoice', ['Invoice', 'Invoice (2)'])).toBe('Invoice (3)');
    expect(uniqueTitle('Invoice (2)', ['Invoice (2)'])).toBe('Invoice (3)');
    expect(uniqueTitle('Receipt', ['Invoice'])).toBe('Receipt');
  });
  it('produces safe file names', () => {
    expect(safeFileName('a/b:c*?.pdf', 'pdf')).toBe('a b c .pdf.pdf');
    expect(safeFileName('   ', 'pdf')).toBe('Document.pdf');
    expect(safeFileName('CON', 'jpg')).toBe('Document.jpg');
    expect(safeFileName('Résumé', '.pdf')).toBe('Resume.pdf');
  });
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

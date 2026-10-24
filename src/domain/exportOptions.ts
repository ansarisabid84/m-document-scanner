import type { PageSizePreset, QualityPreset } from './models';

export type ExportFormat = 'pdf' | 'jpeg' | 'png';
export type ColorMode = 'as-is' | 'grayscale' | 'bw';

export interface ExportOptions {
  format: ExportFormat;
  quality: QualityPreset;
  pageSize: PageSizePreset;
  colorMode: ColorMode;
  ocrLayer: boolean;
  /** e.g. "1-3, 5". Empty = all pages. */
  range: string;
  fileName: string;
}

/** Long-edge pixel cap and JPEG quality per preset. */
export const QUALITY: Record<QualityPreset, { maxDim: number; jpeg: number; label: string; hint: string }> = {
  small: { maxDim: 1400, jpeg: 0.62, label: 'Small', hint: 'Email-friendly' },
  balanced: { maxDim: 2000, jpeg: 0.78, label: 'Balanced', hint: 'Recommended' },
  high: { maxDim: 3000, jpeg: 0.9, label: 'High', hint: 'Best for printing' },
};

/** Page sizes in PDF points (1/72 inch), portrait. */
export const PAGE_SIZES: Record<Exclude<PageSizePreset, 'auto'>, { w: number; h: number; label: string }> = {
  a4: { w: 595.28, h: 841.89, label: 'A4' },
  letter: { w: 612, h: 792, label: 'Letter' },
  legal: { w: 612, h: 1008, label: 'Legal' },
};

/**
 * Parses a 1-based page range like "1-3, 5, 8-" into sorted unique 0-based indices.
 * Returns null when the expression is invalid.
 */
export function parsePageRange(expr: string, pageCount: number): number[] | null {
  const s = expr.trim();
  if (!s) return Array.from({ length: pageCount }, (_, i) => i);
  const out = new Set<number>();
  for (const raw of s.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!m || (!m[1] && !m[3])) return null;
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : pageCount) : a;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount || a > b) return null;
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  if (out.size === 0) return null;
  return [...out].sort((x, y) => x - y);
}

export function validateExport(o: ExportOptions, pageCount: number): string | null {
  if (pageCount === 0) return 'This document has no pages to export.';
  if (!o.fileName.trim()) return 'Enter a file name.';
  if (parsePageRange(o.range, pageCount) === null) return `Page range must be within 1–${pageCount}, e.g. "1-3, 5".`;
  if (o.format !== 'pdf' && o.ocrLayer) return null; // ignored for images
  return null;
}

/** Rough output size estimate in bytes, for display only. */
export function estimateExportBytes(o: ExportOptions, pages: { outWidth: number; outHeight: number }[]): number {
  const q = QUALITY[o.quality];
  let total = 0;
  for (const p of pages) {
    const scale = Math.min(1, q.maxDim / Math.max(p.outWidth || 1, p.outHeight || 1));
    const px = (p.outWidth || 1000) * (p.outHeight || 1400) * scale * scale;
    let bpp: number;
    if (o.format === 'png') bpp = o.colorMode === 'bw' ? 0.18 : o.colorMode === 'grayscale' ? 1.1 : 2.2;
    else bpp = (o.colorMode === 'as-is' ? 0.55 : 0.4) * (0.4 + q.jpeg);
    total += px * bpp;
  }
  if (o.format === 'pdf') total = total * 1.02 + 2048;
  return Math.round(total);
}

/** Fits an image of (w,h) into a page of (pw,ph) with margin, preserving aspect. Returns placement in points. */
export function fitToPage(w: number, h: number, pw: number, ph: number, margin = 0) {
  const aw = pw - margin * 2;
  const ah = ph - margin * 2;
  const s = Math.min(aw / w, ah / h);
  const dw = w * s;
  const dh = h * s;
  return { x: (pw - dw) / 2, y: (ph - dh) / 2, w: dw, h: dh };
}

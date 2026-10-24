import type { DocumentRecord, Page } from '../domain/models';
import { PAGE_SIZES, QUALITY, fitToPage, parsePageRange, type ExportOptions } from '../domain/exportOptions';
import { safeFileName } from '../domain/naming';
import { canvasToBlob, colorMode, decodeBlob, imageToCanvas, serial } from '../imaging/engine';
import { fileStore } from '../infrastructure/fileStore';
import { AppError, toAppError } from '../infrastructure/platform';
import type { OutFile } from '../infrastructure/sharing';

/**
 * Local export. Output contains only the user's pages — no watermark, no branding.
 * The app's own document is never modified, so a failed export can simply be retried.
 */

export type ProgressFn = (done: number, total: number, label: string) => void;

async function preparePage(page: Page, opts: ExportOptions): Promise<{ canvas: HTMLCanvasElement; w: number; h: number }> {
  if (!page.processedPath) throw new AppError('corrupt', 'A page has not finished processing. Open it once and try again.');
  const q = QUALITY[opts.quality];
  const blob = await fileStore.read(page.processedPath);
  let img = await decodeBlob(blob, q.maxDim);
  if (opts.colorMode !== 'as-is') img = await colorMode(img, opts.colorMode, q.maxDim);
  const canvas = imageToCanvas(img);
  return { canvas, w: img.width, h: img.height };
}

/** Standard PDF fonts only cover Latin-1; other scripts are left out of the hidden text layer. */
const LATIN1 = /^[ -ÿ]+$/;

export async function exportDocument(
  doc: DocumentRecord,
  pages: Page[],
  opts: ExportOptions,
  onProgress: ProgressFn,
  signal: AbortSignal,
): Promise<OutFile[]> {
  const accepted = pages.filter((p) => p.accepted).sort((a, b) => a.position - b.position);
  const idx = parsePageRange(opts.range, accepted.length);
  if (!idx) throw new AppError('unknown', 'The page range is not valid.');
  const selected = idx.map((i) => accepted[i]);
  const baseName = opts.fileName.trim() || doc.title;
  const q = QUALITY[opts.quality];
  const check = () => {
    if (signal.aborted) throw new AppError('cancelled', 'Export cancelled.');
  };

  return serial(async () => {
    try {
      if (opts.format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        let pdf: InstanceType<typeof jsPDF> | null = null;
        for (const [n, page] of selected.entries()) {
          check();
          onProgress(n, selected.length, `Preparing page ${n + 1} of ${selected.length}`);
          const { canvas, w, h } = await preparePage(page, opts);
          const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', q.jpeg)).arrayBuffer());
          canvas.width = canvas.height = 0;
          const landscape = w > h;
          let pw: number;
          let ph: number;
          if (opts.pageSize === 'auto') {
            // Original bounds: long edge mapped to A4's long edge.
            const s = 841.89 / Math.max(w, h);
            pw = w * s;
            ph = h * s;
          } else {
            const ps = PAGE_SIZES[opts.pageSize];
            pw = landscape ? ps.h : ps.w;
            ph = landscape ? ps.w : ps.h;
          }
          const orientation = pw > ph ? 'landscape' : 'portrait';
          if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [pw, ph], orientation, compress: true, putOnlyUsedFonts: true });
          else pdf.addPage([pw, ph], orientation);
          const place = fitToPage(w, h, pw, ph, 0);
          pdf.addImage(jpeg, 'JPEG', place.x, place.y, place.w, place.h, undefined, 'NONE');

          if (opts.ocrLayer && page.ocrStatus === 'done' && page.ocrWords?.length) {
            pdf.setFont('helvetica', 'normal');
            for (const word of page.ocrWords) {
              if (!word.t || !LATIN1.test(word.t)) continue;
              const bw = (word.x1 - word.x0) * place.w;
              const bh = (word.y1 - word.y0) * place.h;
              if (bw <= 0 || bh <= 0) continue;
              const size = Math.max(2, bh * 0.92);
              pdf.setFontSize(size);
              const natural = pdf.getTextWidth(word.t) || 1;
              pdf.text(word.t, place.x + word.x0 * place.w, place.y + word.y1 * place.h - bh * 0.18, {
                renderingMode: 'invisible',
                horizontalScale: Math.max(0.2, Math.min(5, bw / natural)),
              } as Record<string, unknown>);
            }
          }
          await new Promise((r) => setTimeout(r, 0));
        }
        check();
        onProgress(selected.length, selected.length, 'Writing PDF');
        pdf!.setProperties({ title: doc.title, creator: 'Document Scanner', subject: '', author: '' });
        const blob = pdf!.output('blob');
        return [{ blob, name: safeFileName(baseName, 'pdf') }];
      }

      const ext = opts.format === 'png' ? 'png' : 'jpg';
      const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
      const out: OutFile[] = [];
      for (const [n, page] of selected.entries()) {
        check();
        onProgress(n, selected.length, `Preparing page ${n + 1} of ${selected.length}`);
        const { canvas } = await preparePage(page, opts);
        const blob = await canvasToBlob(canvas, mime, q.jpeg);
        canvas.width = canvas.height = 0;
        const name = selected.length === 1 ? safeFileName(baseName, ext) : safeFileName(`${baseName} - page ${idx[n] + 1}`, ext);
        out.push({ blob, name });
      }
      onProgress(selected.length, selected.length, 'Done');
      return out;
    } catch (e) {
      throw toAppError(e, 'Export failed. Your document is unchanged — please try again.');
    }
  });
}

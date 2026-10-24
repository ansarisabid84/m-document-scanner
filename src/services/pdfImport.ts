import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Renders pages of an existing PDF to images entirely on-device (pdf.js), so they can be
 * organised, edited, OCR'd and re-exported like scans.
 */

let workerSet = false;
async function pdfjs() {
  const lib = await import('pdfjs-dist');
  if (!workerSet) {
    lib.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
    workerSet = true;
  }
  return lib;
}

export class PdfImportError extends Error {
  constructor(
    public code: 'password' | 'invalid' | 'empty',
    message: string,
  ) {
    super(message);
  }
}

export async function openPdf(data: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  try {
    const doc = await lib.getDocument({ data: new Uint8Array(data), password, isEvalSupported: false, disableFontFace: false }).promise;
    if (doc.numPages < 1) throw new PdfImportError('empty', 'This PDF has no pages.');
    return doc;
  } catch (e) {
    if (e instanceof PdfImportError) throw e;
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') {
      throw new PdfImportError('password', password ? 'That password is incorrect.' : 'This PDF is password-protected. Enter its password to import it.');
    }
    throw new PdfImportError('invalid', 'This file could not be read as a PDF. It may be damaged or unsupported.');
  }
}

/** Renders one page (1-based) to a JPEG blob, long edge ≈ maxDim px. */
export async function renderPdfPage(doc: PDFDocumentProxy, pageNo: number, maxDim: number, type: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<Blob> {
  const page = await doc.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, maxDim / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Render failed'))), type, 0.9));
  canvas.width = canvas.height = 0;
  return blob;
}

import type { MarkupOp, PageEdits } from '../domain/models';
import type { Detection } from './detect';
import type { RGBAImage } from './warp';
import type { WorkerRequest, WorkerResponse } from './imaging.worker';

/**
 * Main-thread facade for the imaging worker. Heavy pixel work never runs on the UI thread,
 * and full-resolution jobs are serialised so only one large image is in memory at a time.
 */

/** Long-edge cap for stored originals and processed pages (≈ 240–300 dpi for A4). */
export const MAX_ORIGINAL_DIM = 3200;
export const MAX_PROCESSED_DIM = 2800;
export const THUMB_DIM = 420;

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./imaging.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
    worker.onerror = (ev) => {
      pending.forEach((p) => p.reject(new Error(ev.message || 'Image processing failed')));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function call<T>(req: Distribute<WorkerRequest>, transfer: Transferable[]): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...req, id }, transfer);
  });
}

// Serialises heavy jobs (decode → process → encode) to bound peak memory.
let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Decodes an image blob (respecting EXIF orientation) into RGBA, downscaled to maxDim. */
export async function decodeBlob(blob: Blob, maxDim: number): Promise<RGBAImage> {
  let source: CanvasImageSource;
  let sw: number;
  let sh: number;
  let cleanup = () => {};
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    source = bmp;
    sw = bmp.width;
    sh = bmp.height;
    cleanup = () => bmp.close();
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      source = img;
      sw = img.naturalWidth;
      sh = img.naturalHeight;
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('This image could not be opened. The file may be corrupt or in an unsupported format.');
    }
    cleanup = () => URL.revokeObjectURL(url);
  }
  if (!sw || !sh) {
    cleanup();
    throw new Error('This image is empty or damaged.');
  }
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  cleanup();
  const id = ctx.getImageData(0, 0, w, h);
  canvas.width = canvas.height = 0;
  return { data: id.data, width: w, height: h };
}

export function imageToCanvas(img: RGBAImage): HTMLCanvasElement {
  const c = createCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image (the device may be low on memory).'))), type, quality),
  );
}

export function scaledCanvas(src: HTMLCanvasElement, maxDim: number): HTMLCanvasElement {
  const s = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (s >= 1) return src;
  const c = createCanvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function detect(img: RGBAImage): Promise<Detection | null> {
  return call<Detection | null>({ type: 'detect', data: img.data, width: img.width, height: img.height }, [img.data.buffer]);
}

export function renderEdits(img: RGBAImage, edits: PageEdits, maxDim = MAX_PROCESSED_DIM): Promise<RGBAImage> {
  return call<RGBAImage>({ type: 'render', data: img.data, width: img.width, height: img.height, edits, maxDim }, [img.data.buffer]);
}

export function colorMode(img: RGBAImage, mode: 'as-is' | 'grayscale' | 'bw', maxDim: number): Promise<RGBAImage> {
  return call<RGBAImage>({ type: 'colorMode', data: img.data, width: img.width, height: img.height, mode, maxDim }, [img.data.buffer]);
}

/** Draws markup ops (normalised coordinates) onto a canvas. Redactions are painted last and opaque. */
export function drawMarkup(ctx: CanvasRenderingContext2D, ops: MarkupOp[], w: number, h: number): void {
  const base = Math.min(w, h);
  const drawStroke = (pts: [number, number][], ox: number, oy: number, sx: number, sy: number) => {
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(ox + pts[0][0] * sx, oy + pts[0][1] * sy, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(ox + pts[0][0] * sx, oy + pts[0][1] * sy);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(ox + pts[i][0] * sx, oy + pts[i][1] * sy, ox + mx * sx, oy + my * sy);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(ox + last[0] * sx, oy + last[1] * sy);
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const op of ops) {
    if (op.kind === 'ink') {
      ctx.globalAlpha = op.highlighter ? 0.35 : 1;
      ctx.globalCompositeOperation = op.highlighter ? 'multiply' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = op.color;
      ctx.lineWidth = Math.max(1, op.width * base);
      drawStroke(op.points, 0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } else if (op.kind === 'text') {
      const size = Math.max(8, op.size * base);
      ctx.fillStyle = op.color;
      ctx.font = `600 ${size}px "Public Sans", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      op.text.split('\n').forEach((line, i) => ctx.fillText(line, op.x * w, op.y * h + i * size * 1.2));
    } else if (op.kind === 'signature') {
      ctx.strokeStyle = ctx.fillStyle = op.color;
      ctx.lineWidth = Math.max(1.5, op.h * h * 0.045);
      for (const s of op.strokes) drawStroke(s, op.x * w, op.y * h, op.w * w, op.h * h);
    }
  }
  for (const op of ops) {
    if (op.kind === 'redact') {
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.floor(op.x * w), Math.floor(op.y * h), Math.ceil(op.w * w) + 1, Math.ceil(op.h * h) + 1);
    }
  }
  ctx.restore();
}

/** Grabs a downscaled RGBA frame from a video element for live detection. */
export function grabFrame(video: HTMLVideoElement, maxDim: number, canvas: HTMLCanvasElement): RGBAImage | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const s = maxDim / Math.max(vw, vh);
  const w = Math.round(vw * s);
  const h = Math.round(vh * s);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: w, height: h };
}

/// <reference lib="webworker" />
import { detectDocument } from './detect';
import { adjust, applyColorMode, applyFilter } from './filters';
import { downscale, rotate90, warpPerspective, type RGBAImage } from './warp';
import type { PageEdits } from '../domain/models';
import { FULL_QUAD } from '../domain/geometry';

export type WorkerRequest =
  | { id: number; type: 'detect'; data: Uint8ClampedArray; width: number; height: number }
  | { id: number; type: 'render'; data: Uint8ClampedArray; width: number; height: number; edits: PageEdits; maxDim: number }
  | { id: number; type: 'colorMode'; data: Uint8ClampedArray; width: number; height: number; mode: 'as-is' | 'grayscale' | 'bw'; maxDim: number };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function reply(msg: WorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'detect') {
      reply({ id: req.id, ok: true, result: detectDocument(req.data, req.width, req.height) });
      return;
    }
    if (req.type === 'render') {
      let img: RGBAImage = { data: req.data, width: req.width, height: req.height };
      const quad = req.edits.quad ?? FULL_QUAD;
      img = req.edits.quad ? warpPerspective(img, quad, req.maxDim) : downscale(img, req.maxDim);
      img = rotate90(img, req.edits.rotation);
      applyFilter(img, req.edits.filter);
      adjust(img, req.edits.brightness, req.edits.contrast);
      reply({ id: req.id, ok: true, result: img }, [img.data.buffer]);
      return;
    }
    if (req.type === 'colorMode') {
      const img = downscale({ data: req.data, width: req.width, height: req.height }, req.maxDim);
      applyColorMode(img, req.mode);
      reply({ id: req.id, ok: true, result: img }, [img.data.buffer]);
    }
  } catch (e) {
    reply({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

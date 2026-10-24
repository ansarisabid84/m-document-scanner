// Copies the on-device OCR runtime (worker, WASM core, English model) into public/
// so OCR works fully offline inside the Capacitor WebView. Nothing is fetched at runtime.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'ocr');
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

function pkgDir(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

try {
  const tjs = pkgDir('tesseract.js');
  cpSync(join(tjs, 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
  const core = pkgDir('tesseract.js-core');
  for (const f of readdirSync(core)) {
    if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f)) cpSync(join(core, f), join(out, 'core', f));
  }
  const eng = pkgDir('@tesseract.js-data/eng');
  const model = join(eng, '4.0.0_best_int', 'eng.traineddata.gz');
  if (existsSync(model)) cpSync(model, join(out, 'lang', 'eng.traineddata.gz'));
  else console.warn('[ocr-assets] English model not found at', model);
  console.log('[ocr-assets] OCR runtime copied to public/ocr');
} catch (err) {
  console.warn('[ocr-assets] Skipped:', err instanceof Error ? err.message : err);
}

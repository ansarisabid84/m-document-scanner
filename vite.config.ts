import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Strict CSP for production builds only (the dev server needs inline HMR scripts).
// connect-src allows jsDelivr solely for explicit, user-initiated OCR language downloads.
const CSP = [
  "default-src 'self' capacitor: https://localhost http://localhost",
  "img-src 'self' data: blob: capacitor: https://localhost http://localhost",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: capacitor: https://localhost http://localhost https://cdn.jsdelivr.net",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: ['es2020', 'safari15', 'chrome90'],
    outDir: 'dist',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          pdf: ['jspdf'],
          pdfjs: ['pdfjs-dist'],
        },
      },
    },
  },
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as never);

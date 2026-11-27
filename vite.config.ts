import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// OCR of scanned PDFs (src/lib/ocr.ts) runs offline: the Tesseract engine and its Spanish data are served from
// /tesseract/ (dev) and copied into the build, straight from node_modules (nothing downloaded at run time).
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'spa.traineddata.gz': '@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz'
};
const ocrFile = (name: string) => { const f = OCR_FILES[name] && join(process.cwd(), 'node_modules', OCR_FILES[name]); return f && existsSync(f) ? f : null; };
function ocrAssets(): Plugin {
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/tesseract\/([^/?]+)/.exec(req.url ?? '');
        const f = m && ocrFile(m[1]);
        if (!f) return next();
        res.setHeader('Content-Type', f.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
        res.end(readFileSync(f));
      });
    },
    generateBundle() {
      for (const name of Object.keys(OCR_FILES)) {
        const f = ocrFile(name);
        if (f) this.emitFile({ type: 'asset', fileName: `tesseract/${name}`, source: readFileSync(f) });
      }
    }
  };
}

// Standard Tauri 2 + Vite configuration.
// `npm run build:web` (VITE_MODE=web) builds the browser version into dist-web/,
// with relative paths so it works inside a subfolder (e.g. example.com/bitacora-tracker/).
const host = process.env.TAURI_DEV_HOST;
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
  plugins: [react(), ocrAssets()],
  base: './',
  // The web version uses the server (api.php) and the sign-in screen
  define: web ? { 'import.meta.env.VITE_MODE': JSON.stringify('web') } : {},
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  publicDir: web ? 'web' : 'public',
  build: {
    outDir: web ? 'dist-web' : 'dist',
    target: web ? 'es2022' : process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 2000
  }
};
});

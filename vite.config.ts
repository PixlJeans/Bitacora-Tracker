import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standard Tauri 2 + Vite configuration.
// `npm run build:web` (VITE_MODE=web) builds the browser version into dist-web/,
// with relative paths so it works inside a subfolder (e.g. example.com/bitacora-tracker/).
const host = process.env.TAURI_DEV_HOST;
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
  plugins: [react()],
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

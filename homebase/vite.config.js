import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Vite's preload helper injects <link rel="modulepreload" crossorigin> at
    // runtime; Chromium never fires load on same-origin CORS preloads here, so
    // dynamic import() awaits forever (infinite spinner). Disable entirely.
    modulePreload: false,
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3749',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
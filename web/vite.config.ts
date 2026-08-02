import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev-only proxy so cookies from the API on :3000 look same-origin to the
// browser served from :5173. In prod, Traefik puts both under one host.
export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});

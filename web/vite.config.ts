import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Dev-only proxy so cookies from the API on :3000 look same-origin to the
// browser served from :5173. In prod, Traefik puts both under one host.
//
// PWA config: install to home screen (per phase-1 DoD), cache the shell,
// NEVER cache /api — the app is online-only for mutations (spec §34).
// The service worker skips waiting so a new deploy takes effect on the
// next reload without an "update available" prompt.
export default defineConfig({
  root: '.',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Bureau de change',
        short_name: 'Change',
        description: "Outil interne d'exploitation d'un bureau de change.",
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0B1220',
        theme_color: '#0B1220',
        orientation: 'portrait',
        lang: 'fr',
        dir: 'auto',
        icons: [
          {
            src: '/pwa-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: '/pwa-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Financial UI cannot serve mutations from cache — anything
        // under /api is fetched every time. See spec §34.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
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

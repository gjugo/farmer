import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    // Phaser alone is ~1.2 MB minified; one chunk is fine for this game.
    chunkSizeWarningLimit: 2000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Farmer',
        short_name: 'Farmer',
        description: 'A cheerful 2D farming game.',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#2f4a2a',
        theme_color: '#2f4a2a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only the app shell; the ~58 MB of sprites and audio are cached as they are first loaded.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}', 'icons/*.png', 'assets/farm/manifest.json'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(assets\/farm|audio)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'farmer-assets',
              expiration: { maxEntries: 3000 },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
});

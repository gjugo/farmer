import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    // Phaser alone is ~1.2 MB minified; one chunk is fine for this game.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

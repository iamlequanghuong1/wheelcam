import { defineConfig } from 'vite';

// Relative base so the build works from any folder or static host.
// The target matches the Chromium inside OBS 28 and newer.
export default defineConfig({
  base: './',
  build: {
    target: ['chrome95', 'edge95', 'firefox100', 'safari15'],
    cssTarget: ['chrome95', 'edge95', 'firefox100', 'safari15'],
  },
});

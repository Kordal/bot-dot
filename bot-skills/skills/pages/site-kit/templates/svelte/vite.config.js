import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base "./": the page is served under an address of its own, so every file is asked for relatively.
// public/ (data.json and the kit) is copied into dist/ as it is.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});

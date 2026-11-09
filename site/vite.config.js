// botdot.app (ADR 172): every page is prerendered to plain HTML in build/, with no JavaScript of SvelteKit's in the
// browser (csr = false in src/routes/+layout.js); GitHub Pages serves the folder (.github/workflows/site-publish.yml).
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({
    adapter: adapter({ pages: 'build', assets: 'build', strict: true }),
    paths: { origin: 'https://botdot.app' },
  })],
});

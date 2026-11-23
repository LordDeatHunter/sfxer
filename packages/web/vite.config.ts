import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [tailwindcss(), svelte()],
  resolve: {
    // Use the engine's source directly so edits to it hot-reload here.
    alias: { '@sfxer/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  worker: { format: 'es' },
});

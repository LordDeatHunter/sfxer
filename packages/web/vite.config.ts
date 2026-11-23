import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    // Use the engine's source directly so edits to it hot-reload here.
    alias: { '@sfxer/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  worker: { format: 'es' },
});

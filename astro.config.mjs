import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';

// Static output only. No SSR adapter, ever -- see CLAUDE.md.
export default defineConfig({
  output: 'static',
  integrations: [react()],
  vite: {
    plugins: [tailwind()],
    build: {
      // Keep asset URLs relative so a saved-to-disk page still resolves them.
      assetsInlineLimit: 0,
    },
  },
});

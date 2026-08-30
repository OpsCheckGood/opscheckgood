import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';

// Static output only. No SSR adapter, ever -- see CLAUDE.md.
// Served at the site root by default. Set PUBLIC_BASE to mount it under a
// path instead -- the VPS preview is proxied at /ocg because the upstream
// firewall there admits only 80/443/22, so it has to share nginx with the
// other sites on that host rather than get a port of its own.
const base = process.env.PUBLIC_BASE || '/';

export default defineConfig({
  output: 'static',
  base,
  integrations: [react()],
  vite: {
    plugins: [tailwind()],
    build: {
      // Keep asset URLs relative so a saved-to-disk page still resolves them.
      assetsInlineLimit: 0,
    },
  },
});

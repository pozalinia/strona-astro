// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://pozalinia.pl',
  // Adresy 1:1 jak w Publii: /post/slug/, /post/tags/slug/page/2/
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  vite: {
    build: {
      // Skrypt banera cookies jako jeden plik w /_astro/ (cache), a nie kopia w każdym HTML
      assetsInlineLimit: 0,
    },
  },
});

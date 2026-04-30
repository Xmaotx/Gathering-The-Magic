import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// On GitHub Pages, the site is served from /<repo-name>/, so we set `base`
// to that path during production builds. For local `npm run dev` we leave
// it as '/' so localhost works normally.
//
// Set the GH_PAGES_BASE env var (or just edit the default below) to match
// your repository name. Example: if your repo is `gathering-the-magic`,
// the production URL will be https://<user>.github.io/gathering-the-magic/
// and base must be '/gathering-the-magic/'.
const repoBase = process.env.GH_PAGES_BASE || '/gathering-the-magic/';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? repoBase : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Gathering the Magic',
        short_name: 'GtM',
        description:
          'A Pokémon-style overworld + turn-based duels themed around the Magic: The Gathering color wheel.',
        theme_color: '#1a1428',
        background_color: '#0a0614',
        display: 'standalone',
        orientation: 'portrait',
        // `start_url` and `scope` are relative — Vite rewrites them with the
        // correct `base` at build time so the manifest works on GH Pages.
        start_url: '.',
        scope: '.',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache everything that's hashed by Vite for offline play.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Google Fonts are referenced by the game's CSS (Cinzel + Silkscreen).
        // Cache them at runtime so the game looks right offline after the first load.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
}));

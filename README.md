# Gathering the Magic — PWA

A Pokémon-style overworld + turn-based duel prototype themed around the
Magic: The Gathering color wheel. Packaged as an installable Progressive
Web App you can deploy to GitHub Pages in a few minutes.

## Run it locally

You'll need [Node.js 20+](https://nodejs.org).

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Saves go to
`localStorage` under the `gtm-storage:` prefix, so they persist across
reloads but live only in that browser.

## Deploy to GitHub Pages (the easy way)

1. **Create a repo on GitHub** (any name — `gathering-the-magic` is a good default).
2. **Push this folder to it:**
   ```bash
   git init
   git add .
   git commit -m "Initial PWA scaffold"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
3. **Enable Pages with GitHub Actions:** go to your repo on github.com →
   **Settings** → **Pages** → set **Source** to **GitHub Actions**.
4. That's it. The workflow in `.github/workflows/deploy.yml` runs on every
   push to `main`, builds the PWA, and publishes it to
   `https://<your-username>.github.io/<your-repo>/`.

The workflow auto-derives the asset base path from your repo name, so you
can rename the repo without editing config.

### Manual deploys (alternative)

If you'd rather deploy from your laptop instead of via Actions:

```bash
# Edit vite.config.js → set repoBase to '/<your-repo>/'
npm run deploy
```

This uses the `gh-pages` package to push `dist/` to the `gh-pages` branch.
You'll then need to set **Settings → Pages → Source** to **Deploy from a
branch → gh-pages** instead of **GitHub Actions**.

## Installing as an app

Once deployed (over HTTPS — GitHub Pages handles that automatically),
visitors can install the game like a native app:

- **Chrome / Edge desktop:** an "Install" icon appears in the address bar.
- **Android Chrome:** menu → **Install app** / **Add to Home screen**.
- **iOS Safari:** Share → **Add to Home Screen**. (iOS doesn't support
  full PWA installation prompts, but the manifest, icon, and offline cache
  still work.)

After install, the service worker keeps a cached copy of every asset,
so the game launches and runs offline. New deploys auto-update on the
next launch.

## Project layout

```
.
├── .github/workflows/deploy.yml   ← Pages auto-deploy
├── public/                        ← static assets (icons, favicon)
├── src/
│   ├── GatheringTheMagic.jsx      ← the game (unmodified from the original)
│   ├── storageShim.js             ← polyfills window.storage onto localStorage
│   ├── main.jsx                   ← React entry point + SW registration
│   ├── index.css                  ← page-level reset
├── index.html
├── vite.config.js                 ← Vite + vite-plugin-pwa configuration
├── generate_icons.py              ← regenerates the PWA icon set (Pillow)
└── package.json
```

### Why the storage shim?

The game was originally authored for Claude's artifact runtime, which
exposes a `window.storage` API with async `get/set/delete/list` methods.
Browsers don't have that natively. Rather than touch the 5,000+ lines of
game logic, `src/storageShim.js` installs a polyfill of the same shape
backed by `localStorage`. The game can't tell the difference. If
`localStorage` is unavailable (Safari Private Mode, embedded browsers),
the shim transparently falls back to an in-memory store and the game's
own diagnostic UI will surface that to the player.

## Regenerating the icons

If you want to tweak the icon design, edit `generate_icons.py` and run:

```bash
python3 generate_icons.py
```

It writes `icon-192.png`, `icon-512.png`, `icon-maskable.png`, and
`apple-touch-icon.png` into `public/`. Requires Pillow:
`pip install Pillow`.

## Troubleshooting

**The site loads but assets 404 with paths like `/assets/index-abc.js`.**
Your `base` path doesn't match the repo. The Actions workflow sets it
automatically; for manual deploys, edit `vite.config.js`:
```js
const repoBase = process.env.GH_PAGES_BASE || '/<your-repo-name>/';
```

**Saves disappear between sessions on iOS.** iOS Safari may evict
`localStorage` for sites the user hasn't interacted with for several
weeks. Installing the PWA to the home screen mitigates this.

**Updates don't show up after a new deploy.** Service workers cache the
old version. Either close all tabs of the site and reopen, or use
**Application → Service Workers → Update** in DevTools. The
`registerType: 'autoUpdate'` config makes this happen on the next normal
reload after the new SW finishes installing.

## License

Game design and code in this repo are original. The mechanics are
*inspired by* Pokémon and Magic: The Gathering but contain none of their
trademarked names, characters, or art. Don't republish using protected
IP.

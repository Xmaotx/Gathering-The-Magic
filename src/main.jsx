// Install the window.storage shim BEFORE React mounts. The order matters:
// the game's module-level code probes window.storage, so the polyfill must
// already be in place when GatheringTheMagic.jsx is imported.
import './storageShim.js';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import GatheringTheMagic from './GatheringTheMagic.jsx';
import './index.css';

// vite-plugin-pwa registers the service worker for us at build time via
// the virtual module. Importing it here wires up auto-update on new
// deploys (the user gets the new version on their next reload).
import { registerSW } from 'virtual:pwa-register';
registerSW({ immediate: true });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GatheringTheMagic />
  </StrictMode>
);

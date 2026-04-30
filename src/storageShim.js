// =========================================================================
// window.storage shim
// =========================================================================
// The game (GatheringTheMagic.jsx) was originally written for Claude's
// artifact runtime, which exposes a `window.storage` API with async
// get/set/delete/list methods. Browsers don't have that API natively —
// but we don't want to touch the 5,000+ lines of game code, so instead
// we install a polyfill here that satisfies the same shape using the
// standard `localStorage` API.
//
// IMPORTANT: this module is imported at the top of `main.jsx` BEFORE any
// React code runs, so the shim is in place before the game initializes.
// =========================================================================

const STORAGE_PREFIX = 'gtm-storage:';

// Only install if there isn't already a real storage API present (e.g.,
// when running inside Claude itself the native one would be used).
if (typeof window !== 'undefined' && !window.storage) {
  // Detect whether localStorage actually works — Safari Private Mode and
  // some embedded browsers throw on access. If it's broken, we fall back
  // to an in-memory store so the game still runs (saves just won't persist
  // across reloads, and the game's own diagnostic UI will explain that).
  let memFallback = null;
  let useMem = false;
  try {
    const testKey = '__gtm_probe__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
  } catch (e) {
    console.warn('[storage shim] localStorage unavailable — using in-memory fallback.', e);
    useMem = true;
    memFallback = new Map();
  }

  const read = (k) => (useMem ? (memFallback.has(k) ? memFallback.get(k) : null) : localStorage.getItem(k));
  const write = (k, v) => (useMem ? memFallback.set(k, v) : localStorage.setItem(k, v));
  const del = (k) => (useMem ? memFallback.delete(k) : localStorage.removeItem(k));
  const allKeys = () => {
    if (useMem) return Array.from(memFallback.keys());
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out.push(k);
    }
    return out;
  };

  window.storage = {
    async get(key) {
      const full = STORAGE_PREFIX + key;
      const value = read(full);
      if (value === null || value === undefined) return null;
      return { key, value, shared: false };
    },
    async set(key, value) {
      const full = STORAGE_PREFIX + key;
      // localStorage requires strings — coerce to be safe.
      write(full, typeof value === 'string' ? value : String(value));
      return { key, value, shared: false };
    },
    async delete(key) {
      const full = STORAGE_PREFIX + key;
      const existed = read(full) !== null;
      del(full);
      return { key, deleted: existed, shared: false };
    },
    async list(prefix) {
      const wantPrefix = STORAGE_PREFIX + (prefix || '');
      const keys = allKeys()
        .filter((k) => k.startsWith(wantPrefix))
        .map((k) => k.slice(STORAGE_PREFIX.length));
      return { keys, prefix, shared: false };
    },
  };

  console.log('[storage shim] window.storage installed (backend: ' + (useMem ? 'memory' : 'localStorage') + ')');
}

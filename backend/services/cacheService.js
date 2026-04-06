// backend/services/cacheService.js
const store = new Map();

module.exports = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
    return entry.value;
  },
  set(key, value, ttlSeconds) {
    store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  },
  delete(key) { store.delete(key); },
  clear()     { store.clear(); },
};

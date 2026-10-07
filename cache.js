/* cache.js — Exact計算結果のインメモリCache (Canonical Key専用) */
(function (root) {
  'use strict';
  const cache = new Map();
  let hits = 0, misses = 0;
  function get(key) {
    if (cache.has(key)) { hits++; return cache.get(key); }
    misses++;
    return null;
  }
  function set(key, value) { cache.set(key, value); }
  function clear() { cache.clear(); hits = 0; misses = 0; }
  function stats() {
    const total = hits + misses;
    return { hits, misses, hitRate: total === 0 ? 0 : hits / total, size: cache.size };
  }
  const api = { get, set, clear, stats };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DealCache = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* analysis/textureAnalyzer.js — board-only texture analysis */
(function (root) {
  'use strict';

  const WINDOWS = [
    [12,0,1,2,3],[0,1,2,3],[1,2,3,4],[2,3,4,5],[3,4,5,6],
    [4,5,6,7],[5,6,7,8],[6,7,8,9],[7,8,9,10],[8,9,10,11],[9,10,11,12]
  ];

  function analyzeBoardTexture(board) {
    const cards = Array.from(new Set((board || []).filter((c) => Number.isInteger(c) && c >= 0 && c < 52)));
    if (cards.length < 3) return { tags: [] };

    const ranks = cards.map((c) => c >> 2);
    const suits = cards.map((c) => c & 3);
    const tags = [];

    const suitCounts = [0,0,0,0];
    suits.forEach((s) => { suitCounts[s]++; });
    if (cards.length === 3 && suitCounts.every((n) => n <= 1)) tags.push('RAINBOW');
    else if (suitCounts.every((n) => n <= 1)) tags.push('RAINBOW');
    if (suitCounts.some((n) => n === cards.length)) tags.push('MONOTONE');
    if (new Set(ranks).size < ranks.length) tags.push('PAIRED');

    const rankSet = new Set(ranks);
    const connected = WINDOWS.some((window) => {
      let count = 0;
      window.forEach((r) => { if (rankSet.has(r)) count++; });
      return count >= 3;
    });
    if (connected) tags.push('CONNECTED');

    return { tags };
  }

  const api = { analyzeBoardTexture };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DealTextureAnalysis = api;
})(typeof self !== 'undefined' ? self : globalThis);

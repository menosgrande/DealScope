/* analysis/drawAnalyzer.js — player-specific draw analysis (UI/equity independent) */
(function (root) {
  'use strict';

  const PATTERNS = [
    [12, 0, 1, 2, 3], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6], [3, 4, 5, 6, 7], [4, 5, 6, 7, 8],
    [5, 6, 7, 8, 9], [6, 7, 8, 9, 10], [7, 8, 9, 10, 11],
    [8, 9, 10, 11, 12],
  ];
  const OESD_RUNS = [
    [0,1,2,3],[1,2,3,4],[2,3,4,5],[3,4,5,6],
    [4,5,6,7],[5,6,7,8],[6,7,8,9],[7,8,9,10],[8,9,10,11]
  ];

  function validCards(cards) {
    return Array.from(new Set((cards || []).filter((c) => Number.isInteger(c) && c >= 0 && c < 52)));
  }

  const evaluator = root.PokerEq || (typeof require === 'function' ? require('../engine.js') : null);

  function analyzeDraws(holeCards, board) {
    const hole = validCards(holeCards);
    const bd = validCards(board);
    if (hole.length !== 2 || bd.length < 3 || bd.length >= 5) return { draws: [] };

    const cards = hole.concat(bd);
    const rankSet = new Set(cards.map((c) => c >> 2));
    const holeRanks = new Set(hole.map((c) => c >> 2));
    if (!evaluator || typeof evaluator.evaluate !== 'function') return { draws: [] };
    const category = evaluator.evaluate(cards) >>> 20;
    const draws = [];

    if (category < 4) {
      const completionRanks = new Set();
      for (const pattern of PATTERNS) {
        const missing = pattern.filter((r) => !rankSet.has(r));
        if (missing.length !== 1) continue;
        const present = pattern.filter((r) => rankSet.has(r));
        if (!present.some((r) => holeRanks.has(r))) continue;
        completionRanks.add(missing[0]);
      }

      let oesd = false;
      for (const run of OESD_RUNS) {
        if (!run.every((r) => rankSet.has(r))) continue;
        if (!run.some((r) => holeRanks.has(r))) continue;
        const low = run[0] - 1;
        const high = run[3] + 1;
        const completions = [];
        if (low >= 0) completions.push(low);
        else if (run[0] === 0 && rankSet.has(12)) completions.push(12);
        if (high <= 12) completions.push(high);
        if (new Set(completions).size >= 2 &&
            completions.every((r) => completionRanks.has(r))) {
          oesd = true;
          break;
        }
      }

      if (oesd) draws.push({ type: 'OESD' });
      else if (completionRanks.size === 1) draws.push({ type: 'GS' });
    }

    if (category < 5) {
      const suitCounts = [0, 0, 0, 0];
      const holeSuitCounts = [0, 0, 0, 0];
      cards.forEach((c) => { suitCounts[c & 3]++; });
      hole.forEach((c) => { holeSuitCounts[c & 3]++; });
      if (suitCounts.some((n, s) => n === 4 && holeSuitCounts[s] > 0)) {
        draws.push({ type: 'FD' });
      }
    }

    return { draws };
  }

  const api = { analyzeDraws };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DealDrawAnalysis = api;
})(typeof self !== 'undefined' ? self : globalThis);

/* worker.js — 計算エンジン専用Web Worker */
'use strict';

importScripts('engine.js');

let current = 0;

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type !== 'start') return;
  const id = ++current;
  const kind = m.kind;
  let gen;
  try {
    if (kind === 'exact') {
      gen = PokerEq.exactGen(m.hands, m.board);
    } else if (kind === 'exactVsRandom') {
      gen = PokerEq.exactVsRandomGen(m.hands[0], m.board);
    } else if (kind === 'monteCarloVsRandom') {
      gen = PokerEq.monteCarloVsRandomGen(m.hands[0], m.board, m.opponents, m.trials);
    } else {
      throw new Error('unknown calculation kind');
    }

    const step = () => {
      if (id !== current) return;
      const end = performance.now() + 12;
      let progress = 0;
      do {
        const r = gen.next();
        if (r.done) {
          self.postMessage({ type: 'done', id, value: r.value });
          return;
        }
        progress = r.value;
      } while (performance.now() < end);
      self.postMessage({ type: 'progress', id, progress });
      setTimeout(step, 0);
    };
    step();
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err && err.message || err) });
  }
};

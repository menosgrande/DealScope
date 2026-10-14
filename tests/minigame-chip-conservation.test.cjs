'use strict';

/* Integration smoke tests for the CURRENT mini-game page, not the legacy root script. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sources = {
  engine: fs.readFileSync(path.join(root, 'engine.js'), 'utf8'),
  rules: fs.readFileSync(path.join(root, 'minigame/rules.js'), 'utf8'),
  pots: fs.readFileSync(path.join(root, 'minigame/pots.js'), 'utf8'),
  game: fs.readFileSync(path.join(root, 'minigame/minigame.js'), 'utf8'),
};

class MockElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.disabled = false;
    this.style = {};
    this.dataset = {};
    this.handlers = {};
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(name, callback) { this.handlers[name] = callback; }
}
function boot() {
  const elements = Object.create(null);
  const storage = Object.create(null);
  const document = {
    getElementById(id) { return elements[id] || (elements[id] = new MockElement(id)); },
    querySelectorAll() { return []; },
  };
  const sessionStorage = {
    getItem(key) { return storage[key] || null; },
    setItem(key, value) { storage[key] = String(value); },
    removeItem(key) { delete storage[key]; },
  };
  const context = vm.createContext({
    document, sessionStorage, location: { href: '' },
    confirm: () => true,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  context.window = context;
  new vm.Script(sources.engine, { filename: 'engine.js' }).runInContext(context);
  new vm.Script(sources.rules, { filename: 'minigame/rules.js' }).runInContext(context);
  new vm.Script(sources.pots, { filename: 'minigame/pots.js' }).runInContext(context);
  context.DealMiniGameEV = { renderMarkup: () => '' };
  context.DealMiniGameBetSizing = { definitions: () => [], target: () => 0 };
  const instrumented = sources.game.replace(
    /\}\)\(\);\s*$/,
    'window.__test={A,startImported,showdown,foldWin};})();'
  );
  assert.notEqual(instrumented, sources.game, 'current game instrumentation anchor exists');
  new vm.Script(instrumented, { filename: 'minigame/minigame.js' }).runInContext(context);
  return { api: context.__test, elements };
}
function importedPayload(board) {
  return {
    version: 1,
    snapshot: {
      mode: 'known', n: 2, opp: 1,
      players: [[0, 4], [8, 12], [32, 36], [40, 48]],
      board,
    },
    settings: { stack: 1000, smallBlind: 100, bigBlind: 200, startPot: 1000 },
  };
}
function chips(A) {
  return A.players.reduce((sum, p) => sum + (p.stack || 0), 0) + A.pot;
}
function prepareRiver(api, activeCount = 2) {
  const A = api.A;
  api.startImported(importedPayload([16, 20, 24, 40, 44]));
  A.players.forEach((p, i) => {
    p.stack = 900;
    p.contrib = 0;
    p.fold = false;
    p.out = i >= activeCount;
    p.allin = false;
  });
  A.players[0].hand = [0, 4];
  A.players[1].hand = [8, 12];
  A.players[2].hand = [32, 36];
  A.board = [16, 20, 24, 40, 44];
  A.street = 'river';
  A.handOver = false;
  A.finished = false;
  A.basePot = 1000;
  A.pot = 1000;
  A.awaiting = false;
  return A;
}

{
  const { api, elements } = boot();
  const A = prepareRiver(api);
  A.players[0].contrib = 100;
  A.players[1].contrib = 100;
  A.pot = 1200;
  const before = chips(A);
  api.showdown();
  assert.equal(chips(A), before, 'current mini-game showdown conserves chips');
  assert.equal(A.pot, 0, 'showdown clears the displayed pot');
  assert.equal(A.awards.reduce((sum, a) => sum + a.amount, 0), 1200, 'imported pot plus current contributions are paid exactly once');
  assert.match(A.message, /総額 1,200/, 'showdown summary reports the imported pot');
  assert.equal(elements.nextBtn.style.display, 'block', 'next-hand control is shown after showdown');
}

{
  const { api } = boot();
  const A = prepareRiver(api);
  A.players[0].contrib = 100;
  A.players[1].fold = true;
  A.pot = 1100;
  const before = chips(A);
  assert.equal(api.foldWin(), true);
  assert.equal(chips(A), before, 'fold win conserves chips');
  assert.equal(A.players[0].stack, 2000, 'remaining player receives the entire displayed pot exactly once');
  assert.equal(A.pot, 0);
}

{
  const { api } = boot();
  const A = prepareRiver(api, 3);
  A.players[0].contrib = 100;
  A.players[1].contrib = 200;
  A.players[2].contrib = 200;
  A.players[2].fold = true;
  A.pot = 1500;
  const before = chips(A);
  api.showdown();
  assert.equal(chips(A), before, 'showdown with side pots conserves chips');
  assert.equal(A.awards.reduce((sum, a) => sum + a.amount, 0), 1500, 'main pot, side pot, and imported pot are all paid');
  assert.ok(A.awards.every(a => a.seat !== 2), 'folded player cannot receive an award');
}

console.log('PASS: current mini-game showdown/fold-win chip conservation');

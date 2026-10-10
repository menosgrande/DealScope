/* Node built-in smoke tests for the analysis -> mini-game bridge.
 * Run from the repository root: node tests/analysis-minigame-bridge.test.cjs
 * This uses a lightweight DOM mock; it does not replace manual browser testing.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const engineSource = fs.readFileSync(path.join(root, 'engine.js'), 'utf8');
const gameSource = fs.readFileSync(path.join(root, 'minigame.js'), 'utf8');
new vm.Script(engineSource, { filename: 'engine.js' });
new vm.Script(gameSource, { filename: 'minigame.js' });

class MockElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this._html = '';
    this.children = [];
    this.handlers = {};
    this.dataset = {};
  }
  set innerHTML(value) {
    this._html = value;
    this.children = [];
    const re = /<input[^>]*data-stack-seat="(\d+)"[^>]*>/g;
    let match;
    while ((match = re.exec(value))) {
      const input = new MockElement('stack' + match[1]);
      const valueMatch = match[0].match(/value="(\d+)"/);
      input.value = valueMatch ? valueMatch[1] : '';
      input.dataset = { stackSeat: match[1] };
      this.children.push(input);
    }
  }
  get innerHTML() { return this._html; }
  addEventListener(name, callback) { this.handlers[name] = callback; }
  appendChild(child) { this.children.push(child); }
  querySelectorAll(selector) {
    const found = [];
    const walk = (element) => element.children.forEach((child) => {
      if (selector.includes('stack-seat') && child.dataset.stackSeat !== undefined) found.push(child);
      walk(child);
    });
    walk(this);
    return found;
  }
}

function payload(board, mode = 'known', opp = 1) {
  return {
    version: 1,
    snapshot: {
      mode, n: 2, opp,
      players: [[0, 4], [8, 12], [24, 28], [32, 36]],
      board
    },
    equity: mode === 'random' ? [62] : [60, 40],
    approx: false,
    activeCount: mode === 'random' ? 1 + opp : 2,
    createdAt: 1
  };
}

function boot(importPayload) {
  const elements = {};
  const storage = {};
  const timers = [];
  const document = {
    getElementById(id) { return elements[id] || (elements[id] = new MockElement(id)); },
    createElement() { return new MockElement('created'); }
  };
  const sessionStorage = {
    getItem(key) { return storage[key] || null; },
    setItem(key, value) { storage[key] = value; },
    removeItem(key) { delete storage[key]; }
  };
  if (importPayload) storage['dealscope-analysis-game-v1'] = JSON.stringify(importPayload);
  const context = vm.createContext({
    document,
    sessionStorage,
    location: { href: '' },
    confirm: () => true,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    window: {}
  });
  new vm.Script(engineSource, { filename: 'engine.js' }).runInContext(context);
  const instrumented = gameSource.replace(
    /\}\)\(\);\s*$/,
    'window.__test={A,startImported,showdown,foldWin,resetHand,validBridgePayload};})();'
  );
  assert.notEqual(instrumented, gameSource, 'test instrumentation anchor exists');
  new vm.Script(instrumented, { filename: 'minigame.js' }).runInContext(context);
  return { api: context.window.__test, elements, timers };
}

function totalChips(A) {
  return A.players.reduce((sum, player) => sum + (player.stack || 0), 0) + A.pot;
}

function assertUniqueCards(A) {
  const active = A.players.filter((player) => !player.out);
  const cards = active.flatMap((player) => player.hand).concat(A.board);
  assert.equal(new Set(cards).size, cards.length);
  assert.ok(active.every((player) => player.hand.length === 2));
}

for (const [street, board] of [
  ['preflop', [-1, -1, -1, -1, -1]],
  ['flop', [16, 20, 24, -1, -1]],
  ['turn', [16, 20, 24, 40, -1]],
  ['river', [16, 20, 24, 40, 44]]
]) {
  const { api } = boot(payload(board));
  api.startImported();
  assert.equal(api.A.street, street, street + ' start street');
  assert.equal(api.A.players.filter((player) => !player.out).length, 2);
  assertUniqueCards(api.A);
}

{
  const { api } = boot(payload([16, 20, 24, -1, -1], 'random', 3));
  api.startImported();
  assert.equal(api.A.players.filter((player) => !player.out).length, 4);
  assert.deepEqual(Array.from(api.A.players[0].hand), [0, 4]);
  assertUniqueCards(api.A);
}

{
  const bad = payload([0, 20, 24, -1, -1]);
  const { api } = boot(bad);
  assert.equal(api.validBridgePayload(bad), false, 'duplicate Hero/board card rejected');
}

{
  const { api, elements } = boot(payload([16, 20, 24, 40, 44]));
  api.startImported();
  const A = api.A;
  A.players[0].stack = 900; A.players[1].stack = 900;
  A.players[0].contrib = 100; A.players[1].contrib = 100;
  A.board = [16, 20, 24, 40, 44];
  A.pot = 10200; A.basePot = 10000; A.history = [];
  A.handOver = false; A.waitingNext = false; A.awaiting = false;
  const before = totalChips(A);
  api.showdown();
  assert.equal(totalChips(A), before, 'showdown conserves chips');
  assert.equal(A.pot, 0);
  assert.equal(A.waitingNext, true);
  assert.equal(elements.nextHandBtn.hidden, false);
  assert.equal(elements.returnAnalysisBtn.hidden, false);
}

{
  const { api } = boot(payload([16, 20, 24, 40, 44]));
  api.startImported();
  const A = api.A;
  A.players[0].stack = 900; A.players[1].stack = 900;
  A.players[0].contrib = 100; A.players[1].contrib = 100;
  A.players[1].fold = true;
  A.pot = 10200; A.basePot = 10000; A.history = [];
  A.handOver = false; A.waitingNext = false; A.awaiting = false;
  const before = totalChips(A);
  api.foldWin();
  assert.equal(totalChips(A), before, 'fold win conserves chips');
  assert.equal(A.pot, 0);
}

{
  const { api } = boot(null);
  assert.equal(api.A.players.length, 4);
  assert.equal(api.A.players.filter((player) => !player.out).length, 4);
  assert.equal(api.A.street, 'preflop');
  assert.ok(api.A.pot > 0, 'normal mini-game still posts blinds');
}

console.log('PASS: analysis-to-mini-game bridge smoke tests');

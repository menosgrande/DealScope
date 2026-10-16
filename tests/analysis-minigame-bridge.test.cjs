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


/* Regression guard: the calculator must launch the current mini-game, not the legacy root page. */
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const currentGameSource = fs.readFileSync(path.join(root, 'minigame', 'minigame.js'), 'utf8');
const currentGameHtml = fs.readFileSync(path.join(root, 'minigame', 'index.html'), 'utf8');
assert.match(appSource, /location\.href = '\.\/minigame\/'/, 'analysis transfer targets the current mini-game');
assert.match(currentGameSource, /function validImportedPayload\(/, 'current mini-game validates imported scenarios');
assert.match(currentGameSource, /sessionStorage\.getItem\('dealscope-analysis-game-v1'/, 'current mini-game reads the transferred scenario');
assert.match(currentGameHtml, /minigame\.js\?v=[^"]+/, 'current mini-game script has a cache-busting version');


/* Imported postflop pot is a dead/main pot from earlier streets. It must be paid
 * even when no chips have been contributed in the current street. */
const Pots = require('../minigame/pots.js');
{
  const p0 = {seat:0, contrib:0, fold:false};
  const p1 = {seat:1, contrib:0, fold:false};
  const settled = Pots.settle([p0,p1],[{p:p0,s:20},{p:p1,s:10}],1000);
  assert.equal(settled.distributed,1000,'dead pot is distributed without current-street contributions');
  assert.equal(settled.contributed,1000,'dead pot is included in the settlement total');
  assert.deepEqual(settled.awards.map(a=>[a.player.seat,a.amount]),[[0,1000]]);
}
{
  const p0 = {seat:0, contrib:100, fold:false};
  const p1 = {seat:1, contrib:200, fold:false};
  const p2 = {seat:2, contrib:200, fold:true};
  const settled = Pots.settle([p0,p1,p2],[{p:p0,s:10},{p:p1,s:20},{p:p2,s:30}],1000);
  assert.equal(settled.distributed,1500,'dead pot and side pots are both fully distributed');
  assert.equal(settled.contributed,1500,'settlement conserves the imported pot plus contributions');
  assert.equal(settled.awards.reduce((sum,a)=>sum+a.amount,0),1500);
  assert.ok(settled.awards.every(a=>a.player!==p2),'folded player cannot win the dead pot or side pots');
}
assert.match(currentGameSource,/DealMiniGamePots\.settle\(all,scores,A\.basePot\|\|0,A\.dealer\)/,'showdown includes imported starting pot and dealer seat in settlement');
assert.match(currentGameSource,/var total=\(A\.basePot\|\|0\)\+all\.reduce\(function\(s,p\)\{return s\+\(p\.contrib\|\|0\)\},0\);/,'showdown summary total includes imported starting pot');

console.log('PASS: analysis-to-mini-game bridge smoke tests');

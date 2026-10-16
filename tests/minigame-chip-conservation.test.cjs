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
    setTimeout: callback => { if (context.__syncTimers) callback(); return 1; },
    clearTimeout() {},
  });
  context.window = context;
  new vm.Script(sources.engine, { filename: 'engine.js' }).runInContext(context);
  new vm.Script(sources.rules, { filename: 'minigame/rules.js' }).runInContext(context);
  new vm.Script(sources.pots, { filename: 'minigame/pots.js' }).runInContext(context);
  context.DealMiniGameEV = { renderMarkup: () => '', handLabel: () => 'テスト用ハンド' };
  context.DealMiniGameBetSizing = { definitions: () => [], target: () => 0 };
  const instrumented = sources.game.replace(
    /\}\)\(\);\s*$/,
    'window.__test={A,startImported,showdown,foldWin,ai,act,advance,resetHand,restart,nextHand,legalActions,setSeed:function(value){seed=value>>>0},setSyncTimers:function(value){window.__syncTimers=!!value}};})();'
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

// Deterministic decision-policy smoke test across random legal card samples.
// This is not a full tournament simulation; it guards against pathological
// action distributions in representative deep- and short-stack states.
{
  const { api } = boot();
  const A = api.A;
  let sampleSeed = 0x51f15e;
  function rand() {
    sampleSeed ^= sampleSeed << 13;
    sampleSeed ^= sampleSeed >>> 17;
    sampleSeed ^= sampleSeed << 5;
    return (sampleSeed >>> 0) / 4294967296;
  }
  function shuffledDeck() {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  const types = ['tag', 'lag', 'tp', 'lp'];
  const streets = [
    { name: 'preflop', board: 0 },
    { name: 'flop', board: 3 },
    { name: 'turn', board: 4 },
    { name: 'river', board: 5 },
  ];
  const counts = {};
  const preflopOpenBetRates = {};
  for (const type of types) {
    for (const street of streets) {
      for (const facingBet of [false, true]) {
        for (const stackSize of ['deep', 'short']) {
          const key = [type, street.name, facingBet ? 'facing' : 'unopened', stackSize].join('/');
          const tally = { fold: 0, check: 0, call: 0, bet: 0, raise: 0, allin: 0, other: 0 };
          for (let i = 0; i < 120; i++) {
            const deck = shuffledDeck();
            A.players.forEach((p, seat) => {
              p.type = seat === 1 ? type : types[seat];
              p.hand = [deck.pop(), deck.pop()];
              p.stack = stackSize === 'deep' ? 20000 : 1200;
              p.contrib = 0; p.fold = false; p.out = false; p.allin = false;
              p.position = ['BTN', 'CO', 'SB', 'BB'][seat];
            });
            A.board = Array.from({ length: street.board }, () => deck.pop());
            A.street = street.name;
            A.handNo = i + 1;
            A.blinds = [100, 200];
            A.dealer = 3;
            A.lastRaise = 400;
            A.raiseLocked = [false, false, false, false];
            A.roundBet = facingBet ? [600, 200, 600, 600] : [0, 0, 0, 0];
            A.currentBet = facingBet ? 600 : 0;
            A.pot = facingBet ? 1800 : 300;
            api.setSeed(0x12340000 + i * 31 + types.indexOf(type) * 7 + street.board);
            const action = api.ai(A.players[1]);
            const name = action && action.a;
            if (Object.prototype.hasOwnProperty.call(tally, name)) tally[name]++;
            else if (name === 'fold' || name === 'check' || name === 'call' || name === 'bet' || name === 'raise' || name === 'allin') tally[name]++;
            else tally.other++;
          }
          counts[key] = tally;
          if (street.name === 'preflop' && !facingBet && stackSize === 'deep') {
            preflopOpenBetRates[type] = tally.bet / 120;
          }
          const total = Object.values(tally).reduce((sum, value) => sum + value, 0);
          assert.equal(total, 120, key + ' accounts for every sampled decision');
          assert.equal(tally.other, 0, key + ' returns a recognized action');
          if (stackSize === 'deep') {
            assert.equal(tally.allin, 0, key + ' should not produce surprise shoves with 100BB effective stacks');
          }
          if (facingBet) {
            assert.ok(tally.fold + tally.call + tally.raise + tally.allin > 0,
              key + ' should respond to an outstanding bet with a legal response');
          } else {
            assert.equal(tally.fold + tally.call, 0,
              key + ' should not fold/call when no bet is outstanding');
          }
        }
      }
    }
  }
  assert.ok(preflopOpenBetRates.lag > preflopOpenBetRates.tp,
    'LAG should open-bet more often than TP in the same deep-stack preflop samples: '
      + JSON.stringify(preflopOpenBetRates));
  console.log('PASS: CPU decision distribution smoke test (' + Object.keys(counts).length +
    ' strata, ' + Object.keys(counts).length * 120 + ' decisions); deep-stack preflop open-bet rates='
      + JSON.stringify(preflopOpenBetRates));
}

// Full-hand CPU-vs-CPU-policy simulation (Hero also uses the same policy in
// this test harness) to track real game-loop all-ins, showdowns, and pot sizes.
{
  const { api } = boot();
  const A = api.A;
  api.setSeed(0x5eed1234);
  api.setSyncTimers(true);
  api.restart();
  const initialChips = A.players.reduce((sum, p) => sum + p.stack, 0);
  let hands = 0, allInHands = 0, showdowns = 0, totalPot = 0, totalActions = 0;
  const handLimit = 32;
  while (hands < handLimit && !A.finished) {
    let actionGuard = 0;
    while (!A.handOver && !A.finished && actionGuard++ < 300) {
      if (A.awaiting && A.actor === 0) {
        const hero = A.players[0];
        const legal = api.legalActions(hero);
        let d = api.ai(hero);
        if ((d.a === 'bet' && !legal.bet) || (d.a === 'raise' && !legal.raise) ||
            (d.a === 'allin' && !legal.allin)) {
          d = legal.check ? { a: 'check' } : legal.call ? { a: 'call' } : { a: 'fold' };
        }
        let ok = api.act(0, d.a, d.n);
        if (!ok) {
          const fallback = legal.check ? 'check' : legal.call ? 'call' : 'fold';
          ok = api.act(0, fallback);
        }
        assert.equal(ok, true, 'automated Hero policy must always take a legal action');
        A.awaiting = false;
        api.advance();
      } else if (!A.handOver && !A.finished && !A.pending) {
        api.advance();
      }
    }
    assert.ok(actionGuard < 300, 'hand must complete without an action-loop stall');
    if (A.finished) break;
    assert.equal(A.handOver, true, 'simulated hand must reach settlement');
    hands++;
    const handActions = A.history || [];
    if (handActions.some(entry => /オールイン/.test(entry.text))) allInHands++;
    if (A.board.length === 5) showdowns++;
    totalPot += A.awards.reduce((sum, award) => sum + award.amount, 0);
    totalActions += handActions.length;
    assert.equal(A.players.reduce((sum, p) => sum + p.stack, 0) + A.pot, initialChips,
      'total chip pool must remain conserved after every simulated hand');
    if (!A.finished && hands < handLimit) api.nextHand();
  }
  assert.ok(hands >= 12, 'simulation should cover enough hands to observe varied states');
  assert.ok(totalActions >= hands * 2, 'simulation should include meaningful betting action');
  assert.ok(allInHands < hands, 'CPU policy must not turn every simulated hand into an all-in');
  assert.ok(showdowns > 0, 'simulation should reach at least one showdown');
  console.log('PASS: CPU full-hand simulation (' + hands + ' hands, all-in-hand rate='
    + (allInHands / hands * 100).toFixed(1) + '%, showdown rate='
    + (showdowns / hands * 100).toFixed(1) + '%, mean pot='
    + (totalPot / hands).toFixed(0) + ', mean actions='
    + (totalActions / hands).toFixed(1) + ')');
}

console.log('PASS: current mini-game showdown/fold-win chip conservation');

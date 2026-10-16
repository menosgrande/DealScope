'use strict';

// Deterministic boundary tests for the mini-game EV display.
// These cases use a complete river board and known hands, so equity is exact.
const assert = require('node:assert/strict');
const E = require('../engine.js');
const EV = require('../minigame/ev.js');

function card(code) {
  const ranks = '23456789TJQKA';
  const suits = { s: 0, h: 1, d: 2, c: 3 };
  const rank = ranks.indexOf(code[0].toUpperCase());
  const suit = suits[code[1].toLowerCase()];
  assert.notEqual(rank, -1, 'valid rank in test fixture');
  assert.notEqual(suit, undefined, 'valid suit in test fixture');
  return rank * 4 + suit;
}

function baseState() {
  return {
    players: [
      { seat: 0, hand: [card('As'), card('Ah')], stack: 100, contrib: 100, type: 'tag', out: false, fold: false, allin: false },
      { seat: 1, hand: [card('Kd'), card('Kc')], stack: 1000, contrib: 300, type: 'tp', out: false, fold: false, allin: false },
      { seat: 2, hand: [card('Jd'), card('Jh')], stack: 0, contrib: 300, type: 'tag', out: false, fold: false, allin: true },
      { seat: 3, hand: [card('Qs'), card('Qh')], stack: 0, contrib: 300, type: 'lag', out: false, fold: true, allin: false },
    ],
    board: [card('2c'), card('3d'), card('4h'), card('5s'), card('9c')],
    street: 'river',
    handNo: 7,
    actor: 0,
    awaiting: true,
    currentBet: 200,
    roundBet: [100, 200, 200, 200],
    pot: 1000,
    blinds: [100, 200],
    legal: { minRaise: 400 },
    knownHands: true,
    engine: E,
  };
}

function row(result, kind) {
  const found = result.rows.find(r => r.kind === kind);
  assert(found, 'expected ' + kind + ' row');
  return found;
}

// Hero has a wheel straight on the river and wins exactly against both
// non-folded hands. The folded player's chips stay in the pot, but the
// excess above Hero's post-call contribution is not contestable by Hero.
{
  const s = baseState();
  const result = EV.estimate(s, 400);
  assert.equal(result.status, 'ok');
  assert.equal(result.exact, true, 'river known-hand equity must use exact enumeration');
  assert.equal(result.equityPct, 100, 'the wheel straight beats both remaining pairs');
  assert.equal(row(result, 'fold').evBB, 0);
  assert.equal(row(result, 'call').name, 'コール 100');
  assert.equal(row(result, 'call').evBB, 3.5,
    'eligible pot is 700 chips; net call EV is 700 chips / 200-chip BB = 3.5 BB');
  assert(!result.rows.some(r => r.kind === 'raise' || r.kind === 'allin'),
    'no raise EV should be offered when the only non-folded responder is all-in');
}

// Short-stack call: a 400-chip call facing a 50-chip stack is capped at 50.
// Each opponent has 400 contributed, but Hero can contest only 50 from each.
{
  const s = baseState();
  s.players[0].stack = 50;
  s.players[0].contrib = 0;
  s.players[1].contrib = 400;
  s.players[2].contrib = 400;
  s.players[3].contrib = 400;
  s.currentBet = 400;
  s.roundBet = [0, 400, 400, 400];
  s.pot = 1200;
  const result = EV.estimate(s, 400);
  assert.equal(result.status, 'ok');
  assert.equal(result.equityPct, 100);
  assert.equal(row(result, 'call').name, 'コール 50',
    'the displayed call amount must not exceed Hero stack');
  assert.equal(row(result, 'call').evBB, 0.75,
    'eligible pot is 150 chips; net short-stack call EV is 150 chips / 200-chip BB = 0.75 BB');
}

// Invalid duplicate known cards must be rejected before equity reaches the UI.
{
  const s = baseState();
  s.players[1].hand = [card('As'), card('Kc')];
  const result = EV.estimate(s, 400);
  assert.equal(result.status, '指定ハンドに重複または不正なカードがあります');
}

console.log('PASS: mini-game EV boundaries — eligible pot, folded contributions, all-in responder, short-stack call, duplicate cards');

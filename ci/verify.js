'use strict';

const assert = require('node:assert/strict');
const E = require('../engine.js');
const S = require('../state.js');
const C = require('../cache.js');

const expected5 = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];

function cards(s) {
  return s.trim().split(/\s+/).filter(Boolean).map(E.cardName ? x => x : x);
}
function card(code) {
  const ranks = '23456789TJQKA';
  const suits = { s: 0, h: 1, d: 2, c: 3 };
  return ranks.indexOf(code[0].toUpperCase()) * 4 + suits[code[1].toLowerCase()];
}
function hand(s) { return s.split(/\s+/).map(card); }

function testFiveCardDistribution() {
  const counts = new Array(9).fill(0);
  const five = new Array(5);
  for (let a = 0; a < 48; a++)
    for (let b = a + 1; b < 49; b++)
      for (let c = b + 1; c < 50; c++)
        for (let d = c + 1; d < 51; d++)
          for (let e = d + 1; e < 52; e++) {
            five[0]=a; five[1]=b; five[2]=c; five[3]=d; five[4]=e;
            counts[E.evaluate(five) >>> 20]++;
          }
  assert.deepEqual(counts, expected5);
  console.log('✓ 5-card distribution 2,598,960');
}

function testEvaluatorOrdering() {
  const cases = [
    ['straight flush', 'As Ks Qs Js Ts', 8],
    ['quads', 'As Ah Ad Ac Ks', 7],
    ['full house', 'As Ah Ad Kc Kh', 6],
    ['flush', 'As Js 8s 5s 2s', 5],
    ['straight', 'As Kd Qh Jc Ts', 4],
    ['trips', 'As Ah Ad Kc Qh', 3],
    ['two pair', 'As Ah Kd Kc Qh', 2],
    ['pair', 'As Ah Kd Qc Jh', 1],
    ['high card', 'As Kd Qh Jc 9s', 0],
  ];
  const scores = cases.map(([n,h,k]) => [n,E.evaluate(hand(h))]);
  for (let i=0;i<scores.length;i++) assert.equal(scores[i][1] >>> 20, cases[i][2]);
  assert(E.evaluate(hand('As Kd Qh Jc Ts')) > E.evaluate(hand('Ks Qd Jh Tc 9s')));
  assert(E.evaluate(hand('5s 4d 3h 2c As')) < E.evaluate(hand('6s 5d 4h 3c 2s')));
  assert(E.evaluate(hand('As Ah Kd Qc Jh')) > E.evaluate(hand('As Ah Qd Jc Th')));
  console.log('✓ evaluator ordering / golden cases');
}

function testSevenCardAndEnumeration() {
  const sets = [
    'As Ks Qs Js Ts 2d 3c',
    'As Ah Ad Ac Ks Qd Jc',
    'As Ah Ad Kc Kh Qd Jc',
    'As Js 8s 5s 2s Qd 3c',
    'As Kd Qh Jc Ts 2d 3c',
  ];
  for (const s of sets) {
    const a=hand(s);
    assert.equal(E.evaluate(a), E.bestFive(a).score);
  }
  const cases = [
    [2, [], 1712304],
    [3, [], 1370754],
    [4, [], 1086008],
    [2, [card('8s'),card('7s'),card('2d')], 990],
    [2, [card('8s'),card('7s'),card('2d'),card('3h')], 44],
    [2, [card('8s'),card('7s'),card('2d'),card('3h'),card('4c')], 1],
  ];
  for (const [n,b,total] of cases) {
    const hs = ['As Ah','Kd Kc','Qs Qh','Jd Jc'].slice(0,n).map(hand);
    assert.equal(E.exactSync(hs,b).total,total);
  }
  console.log('✓ seven-card evaluator / exact enumeration totals');
}

function testEquityConservation() {
  const cases = [
    [hand('As Ah'),hand('Kd Kc')],
    [hand('As Ah'),hand('Kd Kc'),hand('Qs Qh')],
    [hand('As Ah'),hand('Kd Kc'),hand('Qs Qh'),hand('Jd Jc')],
  ];
  for (const hs of cases) {
    const r=E.exactSync(hs,[card('8s'),card('7s'),card('2d'),card('3h'),card('4c')]);
    const sum=r.equity.reduce((a,b)=>a+b,0);
    assert(Math.abs(sum-100)<1e-9);
  }
  console.log('✓ equity conservation');
}

function testCanonicalAndCache() {
  C.clear();
  const a={players:[hand('Ah Ad'),hand('Ks Kd')],board:[card('Qc'),card('Jc'),card('2h')],deadCards:[],calculationMode:'exact',opponentCount:null};
  const b={players:[hand('Ad Ah'),hand('Kd Ks')],board:[card('2h'),card('Qc'),card('Jc')],deadCards:[],calculationMode:'exact',opponentCount:null};
  const ka=S.canonicalKey(S.buildCanonicalState(a));
  const kb=S.canonicalKey(S.buildCanonicalState(b));
  assert.equal(ka,kb);
  const result=E.exactSync(a.players,a.board);
  assert.equal(C.get(ka),null);
  C.set(ka,result);
  assert.equal(C.get(kb),result);
  const st=C.stats();
  assert.equal(st.hits,1); assert.equal(st.misses,1); assert.equal(st.size,1);
  console.log('✓ canonical state / exact cache transparency');
}

function main() {
  testFiveCardDistribution();
  testEvaluatorOrdering();
  testSevenCardAndEnumeration();
  testEquityConservation();
  testCanonicalAndCache();
  console.log('All CI checks passed.');
}
main();

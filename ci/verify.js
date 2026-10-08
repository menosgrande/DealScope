'use strict';

const assert = require('node:assert/strict');
const E = require('../engine.js');
const S = require('../state.js');
const C = require('../cache.js');
const Pots = require('../minigame/pots.js');

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

function testDrawAnalyzer() {
  let r = E.analyzeDraws(hand('5s 6s 7h 8d 2c'), hand('5s 6s 7h 8d 2c'), hand('5s 6s'));
  assert(r.tags.includes('OESD'));
  assert.equal(r.outs, 8);

  r = E.analyzeDraws(hand('2s 4h 5d 6c 8s'), hand('2s 4h 5d 6c 8s'), hand('2s 4h'));
  assert(r.tags.includes('DGS'));
  assert.equal(r.outs, 8);

  r = E.analyzeDraws(hand('6s 5h 7d 9c 2c'), hand('6s 5h 7d 9c 2c'), hand('6s 5h'));
  assert(r.tags.includes('GS'));
  assert.equal(r.outs, 4);

  r = E.analyzeDraws(hand('As Ks 2s 7s Qd'), hand('As Ks 2s 7s Qd'), hand('As Ks'));
  assert(r.tags.includes('FD'));
  assert.equal(r.outs, 9);

  r = E.analyzeDraws(hand('As Kd 2s 7s Qd'), hand('As Kd 2s 7s Qd'), hand('As Kd'));
  assert(r.tags.includes('BDFD'));
  assert.equal(r.outs, 0);

  // A234 / JQKA are one-ended straight draws, not OESD.
  r = E.analyzeDraws(hand('As 2d 3h 4c 9s'), hand('As 2d 3h 4c 9s'), hand('As 2d'));
  assert(r.tags.includes('GS'));
  assert(!r.tags.includes('OESD'));
  assert.equal(r.outs, 4);

  r = E.analyzeDraws(hand('As Kd Qh Jc 2s'), hand('As Kd Qh Jc 2s'), hand('As Kd'));
  assert(r.tags.includes('GS'));
  assert(!r.tags.includes('OESD'));
  assert.equal(r.outs, 4);

  // Board-only draws must not be attributed to Hero.
  r = E.analyzeDraws(hand('Ac Kd 5h 6c 7s 8d'), hand('Ac Kd 5h 6c 7s 8d'), hand('Ac Kd'));
  assert(!r.tags.includes('OESD'));
  assert(!r.tags.includes('DGS'));
  assert(!r.tags.includes('GS'));

  r = E.analyzeDraws(hand('Ac Kd 2h 7h 9h Jh'), hand('Ac Kd 2h 7h 9h Jh'), hand('Ac Kd'));
  assert(!r.tags.includes('FD'));
  assert(!r.tags.includes('BDFD'));

  // Blockers reduce the actual next-card outs.
  r = E.analyzeDraws(
    hand('5s 6s 7h 8d 2c'),
    hand('5s 6s 7h 8d 2c 4h 4d 4s 4c'),
    hand('5s 6s')
  );
  assert(r.tags.includes('OESD'));
  assert.equal(r.outs, 4);

  // A backdoor flush draw disappears once the fourth suited card arrives.
  r = E.analyzeDraws(hand('As Kd 2s 7s Qs'), hand('As Kd 2s 7s Qs'), hand('As Kd'));
  assert(r.tags.includes('FD'));
  assert(!r.tags.includes('BDFD'));
  assert.equal(r.outs, 9);

  console.log('✓ draw analyzer: hole-card aware OESD / DGS / GS / FD / BDFD / blockers');
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


function testMiniGamePotConservation() {
  const p0={seat:0,name:'P0',stack:0,contrib:100,fold:false};
  const p1={seat:1,name:'P1',stack:0,contrib:200,fold:false};
  const p2={seat:2,name:'P2',stack:0,contrib:200,fold:false};
  const p3={seat:3,name:'P3',stack:0,contrib:200,fold:true};
  const scores=[{p:p0,s:10},{p1:p1,s:30},{p:p1,s:30},{p:p2,s:30},{p:p3,s:20}];
  // Correct the intentionally explicit score records before calling the pure distributor.
  scores.splice(1,1,{p:p1,s:30});
  const before=[p0,p1,p2,p3].reduce((sum,p)=>sum+p.stack,0);
  const totalContrib=[p0,p1,p2,p3].reduce((sum,p)=>sum+p.contrib,0);
  const r=Pots.settle([p0,p1,p2,p3],scores);
  const paid=r.awards.reduce((sum,a)=>sum+a.amount,0);
  assert.equal(r.contributed,totalContrib);
  assert.equal(paid,700);
  assert.equal(r.distributed,paid);
  const after=before+paid;
  assert.equal(after,before+700);
  // Main pot: 400 split three ways by best eligible P1/P2 tie -> 200 each, 100 P0.
  // Side pot: 300 split by P1/P2 -> 150 each.
  const a=new Map(r.awards.map(x=>[x.player.name,(a=undefined,0)]));
  const amounts={P0:0,P1:0,P2:0};
  r.awards.forEach(x=>{amounts[x.player.name]+=x.amount;});
  assert.deepEqual(amounts,{P0:100,P1:350,P2:250});
  // Four players all-in equally, heads-up tie: total is preserved.
  const q=[0,1,2,3].map(i=>({seat:i,name:'Q'+i,contrib:200,fold:false}));
  const qs=q.map(p=>({p,s:50}));
  const qr=Pots.settle(q,qs);
  assert.equal(qr.distributed,800);
  assert.deepEqual(qr.awards.map(x=>x.amount),[200,200,200,200]);
  console.log('✓ mini game pot distribution conserves chips');
}

function main() {
  testFiveCardDistribution();
  testEvaluatorOrdering();
  testSevenCardAndEnumeration();
  testEquityConservation();
  testDrawAnalyzer();
  testCanonicalAndCache();
  testMiniGamePotConservation();
  console.log('All CI checks passed.');
}
main();

'use strict';

const assert = require('node:assert/strict');
const E = require('../engine.js');
const S = require('../state.js');
const C = require('../cache.js');
const Pots = require('../minigame/pots.js');
const Rules = require('../minigame/rules.js');
const Draw = require('../analysis/drawAnalyzer.js');
const Texture = require('../analysis/textureAnalyzer.js');

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

function testAnalysisLayer() {
  let r = Draw.analyzeDraws(hand('5s 6s'), hand('7h 8d 2c'));
  assert(r.draws.some(d => d.type === 'OESD'));
  assert.equal(r.draws.length, 1);

  r = Draw.analyzeDraws(hand('6s 5h'), hand('7d 9c 2c'));
  assert(r.draws.some(d => d.type === 'GS'));

  r = Draw.analyzeDraws(hand('As Ks'), hand('2s 7s Qd'));
  assert(r.draws.some(d => d.type === 'FD'));

  r = Draw.analyzeDraws(hand('Qd Jd'), hand('8s 9d Th Kc'));
  assert.equal(r.draws.length, 0);

  r = Draw.analyzeDraws(hand('Ac Kd'), hand('5h 6c 7s'));
  assert.equal(r.draws.length, 0);

  r = Draw.analyzeDraws(hand('As Ks'), hand('2s 7s Qd 3d'));
  assert(r.draws.some(d => d.type === 'FD'));

  r = Draw.analyzeDraws(hand('As Kd'), hand('2s 7s Qs 3s'));
  assert.equal(r.draws.length, 0);

  r = Draw.analyzeDraws(hand('5s 6h'), hand('7d 8c 2s 3h'));
  assert(r.draws.some(d => d.type === 'OESD'));

  r = Draw.analyzeDraws(hand('As Ks'), hand('2s 7s Qd 3h 4c'));
  assert.equal(r.draws.length, 0);

  let t = Texture.analyzeBoardTexture(hand('As Kd 7c'));
  assert(t.tags.includes('RAINBOW'));
  assert(!t.tags.includes('MONOTONE'));
  assert(!t.tags.includes('PAIRED'));
  assert(!t.tags.includes('CONNECTED'));

  t = Texture.analyzeBoardTexture(hand('8s 9d Tc'));
  assert(t.tags.includes('RAINBOW'));
  assert(t.tags.includes('CONNECTED'));

  t = Texture.analyzeBoardTexture(hand('As 7s 3s'));
  assert(t.tags.includes('MONOTONE'));

  t = Texture.analyzeBoardTexture(hand('Ah Ad 7c'));
  assert(t.tags.includes('PAIRED'));

  t = Texture.analyzeBoardTexture(hand('8s 9d Tc 2h'));
  assert(t.tags.includes('CONNECTED'));
  assert(t.tags.includes('RAINBOW'));

  assert.deepEqual(Draw.analyzeDraws([], hand('As Kd 7c')), {draws: []});

  console.log('✓ Analysis Layer: player draws / board texture / input contract');
}

function testBoardDeal() {
  const players=[hand('Ah Kd'), hand('Qs Qd'), [-1,-1], [-1,-1]];
  const empty=[-1,-1,-1,-1,-1];
  let seq=0;
  const rnd=()=>((seq=(seq+7)%52)/52);
  const flop=S.dealBoard(empty,players,rnd);
  assert.equal(flop.filter(c=>c>=0).length,3);
  assert.equal(new Set(flop.filter(c=>c>=0)).size,3);
  assert(!flop.some(c=>players.flat().includes(c)));

  const turn=S.dealBoard(flop,players,rnd);
  assert.equal(turn.filter(c=>c>=0).length,4);
  assert.equal(turn.slice(0,3).join(','),flop.slice(0,3).join(','));

  const river=S.dealBoard(turn,players,rnd);
  assert.equal(river.filter(c=>c>=0).length,5);
  assert.equal(river.slice(0,4).join(','),turn.slice(0,4).join(','));
  console.log('✓ board auto-deal advances flop → turn → river');
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
  const players=[p0,p1,p2,p3];
  const scores=[{p:p0,s:40},{p:p1,s:30},{p:p2,s:30},{p:p3,s:20}];
  const before=players.reduce((sum,p)=>sum+p.stack+p.contrib,0);
  const r=Pots.settle(players,scores);
  r.awards.forEach(a=>{a.player.stack+=a.amount;});
  const after=players.reduce((sum,p)=>sum+p.stack,0);
  assert.equal(r.contributed,700);
  assert.equal(r.distributed,700);
  assert.equal(after,before);
  assert.deepEqual(players.map(p=>p.stack),[400,150,150,0]);

  const q=[0,1,2,3].map(i=>({seat:i,name:'Q'+i,stack:0,contrib:200,fold:false}));
  const qs=q.map(p=>({p,s:50}));
  const qb=q.reduce((sum,p)=>sum+p.stack+p.contrib,0);
  const qr=Pots.settle(q,qs);
  qr.awards.forEach(a=>{a.player.stack+=a.amount;});
  const qa=q.reduce((sum,p)=>sum+p.stack,0);
  assert.equal(qr.distributed,800);
  assert.equal(qa,qb);
  assert.deepEqual(q.map(p=>p.stack),[200,200,200,200]);
  const edge=[
    {seat:0,name:'C',stack:0,contrib:500,fold:true},
    {seat:1,name:'D',stack:0,contrib:300,fold:false},
    {seat:2,name:'F',stack:0,contrib:300,fold:false},
  ];
  const edgeScores=edge.filter(p=>!p.fold).map(p=>({p,s:p.name==='D'?60:50}));
  const eb=edge.reduce((sum,p)=>sum+p.stack+p.contrib,0);
  const er=Pots.settle(edge,edgeScores);
  er.awards.forEach(a=>{a.player.stack+=a.amount;});
  const ea=edge.reduce((sum,p)=>sum+p.stack,0);
  assert.equal(er.contributed,1100);
  assert.equal(er.distributed,1100);
  assert.equal(ea,eb);
  assert.deepEqual(edge.map(p=>p.stack),[0,1100,0]);
  console.log('✓ mini game pot distribution conserves chips');
}
function testMiniGameStateTransitions() {
  const players = [
    {seat:0,out:false,fold:false,allin:true},
    {seat:1,out:false,fold:false,allin:false},
    {seat:2,out:false,fold:true,allin:false},
    {seat:3,out:false,fold:false,allin:false},
  ];
  const base = {players,acted:[true,true,true,true],roundBet:[100,100,0,100],currentBet:100,street:'preflop'};
  assert(Rules.roundComplete(base));
  assert.equal(Rules.nextStreet(base.street),'flop');
  assert(!Rules.shouldShowdown(base));
  assert(Rules.shouldAutoAdvance(base));

  const foldWin={players:players.map((p,i)=>({...p,fold:i!==1,allin:false})),acted:[true,true,true,true],roundBet:[100,100,100,100],currentBet:100,street:'flop'};
  assert(Rules.shouldFoldWin(foldWin));
  assert(Rules.shouldAutoAdvance(foldWin));

  const allIn={players:players.map((p,i)=>({...p,fold:false,allin:true})),acted:[true,true,true,true],roundBet:[100,100,100,100],currentBet:100,street:'turn'};
  assert(Rules.roundComplete(allIn));
  assert.equal(Rules.nextStreet(allIn.street),'river');
  assert(!Rules.shouldShowdown(allIn));

  const river={...allIn,street:'river'};
  assert(Rules.shouldShowdown(river));  assert(Rules.allInRunout(allIn));
  assert.equal(Rules.nextActionSeat(allIn.players,0),-1);


  const bbCheck={
    players:[
      {seat:0,out:false,fold:false,allin:false},
      {seat:1,out:false,fold:false,allin:false},
      {seat:2,out:false,fold:false,allin:false},
      {seat:3,out:false,fold:false,allin:false},
    ],
    acted:[true,true,true,true],roundBet:[200,200,200,200],currentBet:200,street:'preflop'
  };
  assert(Rules.roundComplete(bbCheck));

  const seats=[0,1,2,3].map(i=>({seat:i,out:false}));
  assert.equal(Rules.nextSeat(seats,3),0);
  seats[0].out=true;
  assert.equal(Rules.nextSeat(seats,3),1);
  console.log('✓ mini game state transitions: fold win / round completion / all-in advance / river showdown / BTN rotation');
}

function main() {
  testFiveCardDistribution();
  testEvaluatorOrdering();
  testSevenCardAndEnumeration();
  testEquityConservation();
  testAnalysisLayer();
  testBoardDeal();
  testCanonicalAndCache();
  testMiniGamePotConservation();
  testMiniGameStateTransitions();
  console.log('All CI checks passed.');
}
main();

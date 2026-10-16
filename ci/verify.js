'use strict';

const assert = require('node:assert/strict');
const E = require('../engine.js');
const S = require('../state.js');
const C = require('../cache.js');
const Pots = require('../minigame/pots.js');
const Rules = require('../minigame/rules.js');
const Draw = require('../analysis/drawAnalyzer.js');
const Texture = require('../analysis/textureAnalyzer.js');
const Glossary = require('../glossary-data.js');
const MiniGameEV = require('../minigame/ev.js');

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
  const wheel = E.evaluate(hand('5s 4d 3h 2c As'));
  const sixHigh = E.evaluate(hand('6s 5d 4h 3c 2s'));
  assert.equal(wheel >>> 20, 4, 'A-2-3-4-5 must be classified as a straight');
  assert(wheel < sixHigh, 'the wheel is the lowest straight');
  assert(E.evaluate(hand('As Ah Kd Qc Jh')) > E.evaluate(hand('As Ah Qd Jc Th')));
  assert(E.evaluate(hand('As Ah Kd Qc Jh')) > E.evaluate(hand('Ac Ad Ks Qd Th')),
    'when pair and first two kickers tie, the third kicker decides the winner');
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
  // Independent exact tie case: a royal flush on the board forces a 50/50 split.
  const boardRoyalFlush=hand('As Ks Qs Js Ts');
  const tie=E.exactSync([hand('2c 3d'),hand('4h 5d')],boardRoyalFlush);
  assert.equal(tie.total,1);
  assert.deepEqual(tie.equity,[50,50], 'a board-only royal flush must split equity evenly');
  console.log('✓ equity conservation / exact split-pot reference case');
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

function testInputStateRoundTrips() {
  const source = {
    mode: 'known', n: 3, opp: 2,
    players: [hand('As Kd'), hand('Qs Qh'), hand('Js Jh'), [-1, -1]],
    board: [card('2c'), card('7h'), card('9d'), card('Tc'), -1],
  };
  const hash = S.encode(source);
  const decoded = S.decode(hash);
  assert(decoded, 'a valid known-hand URL should decode');
  assert.equal(decoded.mode, 'known');
  assert.equal(decoded.n, 3);
  assert.deepEqual(decoded.players.slice(0, 3), source.players.slice(0, 3));
  assert.deepEqual(decoded.board, source.board);
  assert.equal(S.encode(decoded), hash, 'encoding a decoded state should be stable');

  const random = {
    mode: 'random', n: 4, opp: 3,
    players: [hand('As Kd'), hand('Qs Qh'), hand('Js Jh'), hand('Ts Th')],
    board: [card('2c'), card('7h'), card('9d'), -1, -1],
  };
  const randomDecoded = S.decode(S.encode(random));
  assert(randomDecoded, 'a valid random-opponent URL should decode');
  assert.equal(randomDecoded.mode, 'random');
  assert.equal(randomDecoded.opp, 3);
  assert.deepEqual(randomDecoded.players[0], random.players[0]);
  assert.deepEqual(randomDecoded.board, random.board);
  assert.deepEqual(randomDecoded.players[1], [-1, -1], 'hidden hands must not leak into a shared URL');

  const duplicate = S.dedupe(
    [card('As'), card('Kd'), -1, -1, -1],
    [[card('As'), card('Qh')], [card('Kd'), card('Jc')], [-1, -1], [-1, -1]]
  );
  assert.equal(duplicate.board[0], card('As'));
  assert.equal(duplicate.players[0][0], -1, 'board cards take precedence over duplicate hole cards');
  assert.equal(duplicate.players[1][0], -1, 'earlier visible cards take precedence over later duplicates');

  const sourcePlayers = [hand('As Kd'), hand('Qs Qh'), hand('Js Jh'), hand('Ts Th')];
  const sourceBoard = [card('2c'), card('7h'), card('9d'), card('Tc'), -1];
  const saved = S.normalizeSaved({ mode: 'known', n: 2, opp: 1, players: sourcePlayers, board: sourceBoard });
  assert(saved, 'valid saved state should normalize');
  assert.deepEqual(saved.players[2], sourcePlayers[2], 'non-visible player cards should remain saved');

  // Saved state retains hidden cards across mode/count changes, while a share URL
  // intentionally contains only the visible Hero and must not leak those cards.
  for (const n of [2, 3, 4]) {
    const normalized = S.normalizeSaved({ mode: 'known', n, opp: 1, players: sourcePlayers, board: sourceBoard });
    assert(normalized, 'valid known state with player count ' + n + ' should normalize');
    const switched = S.normalizeSaved({ ...normalized, mode: 'random', n, opp: Math.min(4, n) });
    assert(switched, 'switching mode should preserve a valid saved state');
    assert.deepEqual(switched.players, sourcePlayers, 'mode/count changes must retain hidden cards in local saved state');
    const shared = S.decode(S.encode({ ...switched, mode: 'random', opp: Math.min(4, n) }));
    assert(shared, 'random-mode share URL should decode');
    assert.deepEqual(shared.players.slice(1), [[-1, -1], [-1, -1], [-1, -1]], 'share URL must not serialize hidden opponents');
  }

  const duplicateSaved = S.normalizeSaved({
    mode: 'random', n: 2, opp: 2,
    players: [hand('As Kd'), hand('As Qh'), hand('Js Jh'), [-1, -1]],
    board: [card('2c'), card('7h'), card('9d'), -1, -1],
  });
  assert(duplicateSaved);
  const usedCards = duplicateSaved.board.concat(...duplicateSaved.players).filter(c => c >= 0);
  assert.equal(new Set(usedCards).size, usedCards.length, 'duplicate saved cards must be deduplicated before calculation');
  assert.equal(S.normalizeSaved({ mode: 'invalid' }), null, 'invalid saved state should be rejected');
  assert.equal(S.normalizeSaved({ mode: 'known', n: 2, players: [[52, 0], [-1, -1], [-1, -1], [-1, -1]], board: [-1, -1, -1, -1, -1] }), null,
    'out-of-range card ids must not enter a normalized state');
  assert.equal(S.decode('#AsKd-2zQh'), null, 'malformed URL card tokens must be rejected');
  console.log('✓ input state: URL round-trip / hidden-hand privacy / mode-count retention / duplicates / invalid state');
}

function testBoardDeal() {
  const players=[hand('Ah Kd'), hand('Qs Qd'), [-1,-1], [-1,-1]];
  const empty=[-1,-1,-1,-1,-1];
  let seq=0;
  const rnd=()=>((seq=(seq+7)%52)/52);
  const flop=S.dealBoard(empty,players,rnd);
  assert.equal(flop.filter(c=>c>=0).length,3);
  assert.equal(new Set(flop.filter(c=>c>=0)).size,3);
  const playerCards = players.flat().filter(c=>c>=0);
  assert(!flop.filter(c=>c>=0).some(c=>playerCards.includes(c)));

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

  // A stronger short stack takes the main pot, while a weaker hand can
  // legitimately receive the side pot when it alone matched the extra chips.
  const board=hand('5d 7s 9h 2c Kd');
  const hero={seat:0,name:'あなた',stack:0,contrib:100,fold:false,hand:hand('5s 5h')};
  const dog={seat:1,name:'攻める狂犬',stack:0,contrib:200,fold:false,hand:hand('7h 9s')};
  const folded={seat:2,name:'フォールド済み',stack:0,contrib:200,fold:true,hand:hand('3c 4c')};
  const sidePlayers=[hero,dog,folded];
  const sideScores=sidePlayers.map(p=>({p,s:E.evaluate(p.hand.concat(board))}));
  assert.equal(sideScores.find(x=>x.p===hero).s>>>20,3,'Hero should have three of a kind');
  assert.equal(sideScores.find(x=>x.p===dog).s>>>20,2,'the opponent should have two pair');
  const side=Pots.settle(sidePlayers,sideScores);
  const paid=Object.fromEntries(side.awards.map(a=>[a.player.seat,(side.awards.filter(x=>x.player===a.player).reduce((sum,x)=>sum+x.amount,0))]));
  assert.equal(side.potCount,2,'main and side pots must be identified as separate contribution layers');
  assert.equal(paid[0],300,'the three-of-a-kind hand wins the main pot');
  assert.equal(paid[1],200,'the weaker two-pair hand only receives the side pot it is eligible for');
  assert.equal(side.distributed,500);
  // Odd-chip tie: total contribution is 3 chips, two live players tie, and
  // the folded contributor must never receive an award. Verify conservation
  // and a one-chip difference without assuming button-relative seat ordering.
  const odd = [
    {seat:0,name:'Odd A',stack:0,contrib:1,fold:false},
    {seat:1,name:'Odd B',stack:0,contrib:1,fold:false},
    {seat:2,name:'Odd folded',stack:0,contrib:1,fold:true}
  ];
  const oddResult = Pots.settle(odd, [
    {p:odd[0],s:100},
    {p:odd[1],s:100},
    {p:odd[2],s:1}
  ]);
  assert.equal(oddResult.contributed,3);
  assert.equal(oddResult.distributed,3);
  assert.deepEqual(oddResult.awards.map(a=>a.amount).sort((a,b)=>a-b),[1,2],
    'an odd-chip split between two tied eligible players must differ by exactly one chip');
  assert(!oddResult.awards.some(a=>a.player===odd[2]), 'folded player must not receive an odd-chip award');

  // With the dealer at seat 1, the first tied winner clockwise from the
  // button is seat 3, so that player receives the odd chip (not array order).
  const clockwise = [
    {seat:0,name:'Dealer folded',stack:0,contrib:1,fold:true},
    {seat:1,name:'Button',stack:0,contrib:0,fold:false},
    {seat:2,name:'Other folded',stack:0,contrib:0,fold:true},
    {seat:3,name:'First left of button',stack:0,contrib:1,fold:false}
  ];
  // Seat 1 (the dealer) and seat 3 both contribute and tie; seat 3 is
  // the first eligible winner clockwise from the button.
  clockwise[1].contrib=1;
  const clockwiseResult=Pots.settle(clockwise,[
    {p:clockwise[1],s:100},
    {p:clockwise[3],s:100}
  ],0,1);
  const clockwisePaid=Object.fromEntries(clockwiseResult.awards.map(a=>[a.player.seat,a.amount]));
  assert.equal(clockwiseResult.distributed,3);
  assert.equal(clockwisePaid[3],2,'odd chip goes to the first tied winner clockwise from the dealer');
  assert.equal(clockwisePaid[1],1);

  console.log('✓ mini game pot distribution conserves chips, distinguishes side-pot winners, and assigns odd chips by dealer order');
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

  // Heads-up: the button is also the small blind; the other live player is BB.
  const headsUp=[{seat:0,out:false},{seat:1,out:true},{seat:2,out:true},{seat:3,out:false}];
  assert.deepEqual(Rules.blindSeats(headsUp,0),{sb:0,bb:3,headsUp:true});
  // Three-handed and full tables retain the normal blind rotation.
  const threeHanded=[{seat:0,out:false},{seat:1,out:true},{seat:2,out:false},{seat:3,out:false}];
  assert.deepEqual(Rules.blindSeats(threeHanded,0),{sb:2,bb:3,headsUp:false});
  assert.deepEqual(Rules.blindSeats(seats,1),{sb:2,bb:3,headsUp:false});
  console.log('✓ mini game state transitions: fold win / round completion / all-in advance / river showdown / BTN rotation / heads-up blinds');
}

function testPreflopRandomReference() {
  // Independent external benchmark: AA versus one uniformly random hand is
  // approximately 85.2% equity (Zayrion calculator, 400k simulated runouts).
  // The published value is rounded and simulated, so compare within 4σ.
  const expected = 85.2;
  const actual = E.monteCarloVsRandom(hand('As Ah'), [], 100000, { seed: 12345 }).equity[0];
  const p = expected / 100;
  const se = Math.max(Math.sqrt(p * (1 - p) / 100000) * 100, 0.05);
  assert(Math.abs(actual - expected) <= 4 * se,
    'preflop AA vs random-hand equity should agree with external reference 85.2% within 4σ; got ' + actual);
  console.log('✓ preflop Monte Carlo reference: AA vs one random hand ≈85.2%');
}

function testMiniGameEVMath() {
  const engine = { monteCarloVsRandom: () => ({ equity: [80] }) };
  function state(overrides) {
    return Object.assign({
      players: [
        { seat: 0, hand: [0, 1], stack: 100, contrib: 0, out: false, fold: false },
        { seat: 1, hand: [4, 5], stack: 100, contrib: 20, out: false, fold: false, type: 'tag', allin: false }
      ],
      board: [], street: 'preflop', handNo: 1, actor: 0, awaiting: true,
      pot: 100, blinds: [5, 10], currentBet: 20, roundBet: [0, 20, 0, 0],
      legal: { minRaise: 40 }, engine
    }, overrides || {});
  }

  // Full call: 80% * (100 + 20) - 20 = 76 chips = 7.6 BB.
  let result = MiniGameEV.estimate(state());
  assert.equal(result.status, 'ok');
  assert.equal(result.equityPct, 80);
  assert.equal(result.rows.find(r => r.kind === 'call').evBB, 7.6);

  // Short all-in call: opponent has contributed 100, Hero can contribute 10.
  // Of a 200-chip pot, 90 chips are unmatched and unavailable to Hero.
  // EV = 80% * (110 eligible pot + 10 Hero call) - 10 = 86 chips = 8.6 BB.
  result = MiniGameEV.estimate(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 10, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 100, contrib: 100, out: false, fold: false, type: 'tag', allin: false }
    ],
    pot: 200, currentBet: 100, roundBet: [0, 100, 0, 0], legal: { minRaise: 200 }
  }));
  assert.equal(result.rows.find(r => r.kind === 'call').evBB, 8.6);

  // Side-pot eligibility is capped at Hero's post-call total contribution.
  // Contributions: Hero 0, live opponent 100, folded player 190; pot = 290.
  // Hero can contest only 10 from each contributor, plus the new 10-chip call.
  result = MiniGameEV.estimate(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 10, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 100, contrib: 100, out: false, fold: false, type: 'tag', allin: false },
      { seat: 2, hand: [8, 9], stack: 0, contrib: 190, out: false, fold: true, type: 'tp', allin: false }
    ],
    pot: 290, currentBet: 100, roundBet: [0, 100, 0, 0], legal: { minRaise: 200 }
  }));
  assert.equal(result.rows.find(r => r.kind === 'call').evBB, 1.4);

  // An all-in opponent's unmatched excess must not inflate Hero's call EV.
  result = MiniGameEV.estimate(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 10, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 0, contrib: 100, out: false, fold: false, type: 'tag', allin: true }
    ],
    pot: 100, currentBet: 100, roundBet: [0, 100, 0, 0], legal: { minRaise: 200 }
  }));
  assert.equal(result.rows.find(r => r.kind === 'call').evBB, 0.6);

  // A single live opponent can have a raise EV estimate.
  result = MiniGameEV.estimate(state(), 40);
  assert.equal(result.raiseEVSuppressed, false);
  assert(result.rows.some(r => r.kind === 'raise'), 'heads-up raise EV should be available');

  // Multiway aggressive EV is intentionally suppressed because independent fold-rate assumptions are too fragile.
  result = MiniGameEV.estimate(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 100, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 100, contrib: 20, out: false, fold: false, type: 'tag', allin: false },
      { seat: 2, hand: [8, 9], stack: 100, contrib: 20, out: false, fold: false, type: 'tp', allin: false }
    ],
    pot: 100, currentBet: 20, roundBet: [0, 20, 20, 0], legal: { minRaise: 40 }
  }), 40);
  assert.equal(result.raiseEVSuppressed, true);
  assert(!result.rows.some(r => r.kind === 'raise'), 'multiway raise EV should be suppressed');
  assert(!result.rows.some(r => r.name === 'オールイン'), 'multiway all-in EV should be suppressed');
  assert(MiniGameEV.renderMarkup(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 100, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 100, contrib: 20, out: false, fold: false, type: 'tag', allin: false },
      { seat: 2, hand: [8, 9], stack: 100, contrib: 20, out: false, fold: false, type: 'tp', allin: false }
    ],
    pot: 100, currentBet: 20, roundBet: [0, 20, 20, 0], legal: { minRaise: 40 }
  }), 40).includes('推定誤差が大きいため'));
  // Imported known-hand flop: 77 versus K6 and a set of 44 on T-2-4.
  const knownHands = [hand('7c 7d'), hand('6d Kc'), hand('4h 4d')];
  const knownBoard = hand('Th 2d 4c');
  const exactExpected = E.exactSync(knownHands, knownBoard);
  result = MiniGameEV.estimate({
    players: [
      { seat: 0, hand: knownHands[0], stack: 10000, contrib: 0, out: false, fold: false },
      { seat: 1, hand: knownHands[1], stack: 10000, contrib: 0, out: false, fold: false, type: 'tag', allin: false },
      { seat: 2, hand: knownHands[2], stack: 10000, contrib: 0, out: false, fold: false, type: 'tp', allin: false }
    ],
    board: knownBoard, street: 'flop', handNo: 1, actor: 0, awaiting: true,
    pot: 300, blinds: [100, 200], currentBet: 0, roundBet: [0, 0, 0, 0],
    legal: { minRaise: 200 }, knownHands: true, engine: E
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.equityMode, 'known');
  assert.equal(result.exact, true, 'flop known-hand equity should enumerate all runouts exactly');
  assert.equal(result.equityPct, Math.round(exactExpected.equity[0] * 10) / 10);
  const duplicateResult = MiniGameEV.estimate({
    players: [
      { seat: 0, hand: knownHands[0], stack: 10000, out: false, fold: false },
      { seat: 1, hand: knownHands[0], stack: 10000, out: false, fold: false, type: 'tag', allin: false }
    ],
    board: knownBoard, actor: 0, awaiting: true, pot: 100, blinds: [100, 200],
    currentBet: 0, roundBet: [0, 0, 0, 0], legal: { minRaise: 200 },
    knownHands: true, engine: E
  });
  assert.notEqual(duplicateResult.status, 'ok', 'duplicate known cards must be rejected');
  const malformedOpponent = MiniGameEV.estimate(state({
    knownHands: true,
    players: [
      { seat: 0, hand: [0, 1], stack: 100, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [52, 5], stack: 100, contrib: 0, out: false, fold: false, type: 'tag', allin: false }
    ]
  }));
  assert.notEqual(malformedOpponent.status, 'ok',
    'malformed known opponent cards must be rejected, not silently replaced by random opponents');
  const malformedHero = MiniGameEV.estimate(state({
    knownHands: true,
    players: [
      { seat: 0, hand: [52, 1], stack: 100, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 100, contrib: 0, out: false, fold: false, type: 'tag', allin: false }
    ]
  }));
  assert.notEqual(malformedHero.status, 'ok', 'malformed Hero cards must be rejected');

  // If the selected raise target exceeds Hero's stack, EV must use and label
  // the effective all-in target, not the unreachable requested target.
  result = MiniGameEV.estimate(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 1200, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 5000, contrib: 1000, out: false, fold: false, type: 'tag', allin: false }
    ],
    pot: 2000, currentBet: 1000, roundBet: [0, 1000, 0, 0],
    blinds: [100, 200], legal: { minRaise: 2000 }
  }), 3000);
  const cappedRows = result.rows.filter(r => r.kind === 'raise' || r.kind === 'allin');
  assert.equal(cappedRows.length, 1, 'stack-capped selected raise must not duplicate the all-in EV row');
  assert.equal(cappedRows[0].name, 'オールイン', 'stack-capped raise must be labeled with the effective all-in action');

  // A legal short all-in raise may be below the normal minimum raise target.
  result = MiniGameEV.estimate(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 1100, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 5000, contrib: 1000, out: false, fold: false, type: 'tag', allin: false }
    ],
    pot: 2000, currentBet: 1000, roundBet: [0, 1000, 0, 0],
    blinds: [100, 200], legal: { minRaise: 2000 }
  }));
  assert(result.rows.some(r => r.name === 'オールイン' && r.kind === 'raise'),
    'short all-in raise below the normal minimum must be represented when Hero can raise all-in');

  // No active responder means no aggressive EV row, but fold/call context remains available.
  result = MiniGameEV.estimate(state({
    players: [
      { seat: 0, hand: [0, 1], stack: 100, contrib: 0, out: false, fold: false },
      { seat: 1, hand: [4, 5], stack: 0, contrib: 100, out: false, fold: false, type: 'tag', allin: true }
    ],
    pot: 200, currentBet: 100, roundBet: [0, 100, 0, 0], legal: { minRaise: 200 }
  }));
  assert.equal(result.raiseEVSuppressed, true);
  assert(!result.rows.some(r => r.kind === 'raise' || r.kind === 'allin'),
    'all-in opponents cannot respond to Hero raises');
  console.log('✓ mini-game EV arithmetic / side-pot boundary / raise caps / short all-in / responder boundaries');
}

function testGlossaryData() {
  const terms = Glossary.terms;
  assert(Array.isArray(terms));
  assert(terms.length >= 250, 'glossary should contain the broad reference vocabulary');
  const names = terms.map(t => t.term);
  assert.equal(new Set(names).size, names.length, 'glossary terms should be unique');
  for (const t of terms) {
    assert(t.term && t.english && t.category && t.definition, 'every glossary entry needs a term, English label, category, and definition');
    assert(Number.isInteger(t.stars) && t.stars >= 1 && t.stars <= 5, 'importance must be rated from one to five stars');
  }
  for (const term of ['アンダーザガン','コール','サイドポット','エクイティ','ポットオッズ','GTO','MTT']) {
    assert(names.includes(term), 'expected glossary term: ' + term);
  }
  assert.equal(terms.find(t => t.term === 'アンダーザガン').abbreviation, 'UTG', 'UTG abbreviation should be displayed with its Japanese term');
  assert.equal(terms.find(t => t.term === 'アウトオブポジション').abbreviation, 'OOP', 'OOP abbreviation should be available');
  console.log('✓ glossary data ' + terms.length + ' terms / categories / star ratings');
}

function main() {
  testPreflopRandomReference();
  testMiniGameEVMath();
  testGlossaryData();
  testFiveCardDistribution();
  testEvaluatorOrdering();
  testSevenCardAndEnumeration();
  testEquityConservation();
  testInputStateRoundTrips();
  testAnalysisLayer();
  testBoardDeal();
  testCanonicalAndCache();
  testMiniGamePotConservation();
  testMiniGameStateTransitions();
  console.log('All CI checks passed.');
}
main();

'use strict';

const assert = require('node:assert/strict');
const E = require('../engine.js');
const EV = require('../minigame/ev.js');
const BetSizing = require('../minigame/bet-sizing.js');

function card(code) {
  const ranks = '23456789TJQKA';
  const suits = {s:0,h:1,d:2,c:3};
  return ranks.indexOf(code[0]) * 4 + suits[code[1].toLowerCase()];
}
function state(target) {
  return {
    players: [
      {seat:0, hand:[card('Qh'),card('9d')], stack:20000, type:'tag', out:false, fold:false, allin:false},
      {seat:1, hand:[card('As'),card('Kd')], stack:19900, type:'lag', out:false, fold:false, allin:false},
      {seat:2, hand:[card('Jc'),card('Jh')], stack:19800, type:'tp', out:false, fold:false, allin:false},
      {seat:3, hand:[card('8s'),card('8d')], stack:19800, type:'lp', out:false, fold:false, allin:false},
    ],
    board:[], street:'preflop', handNo:1, actor:0, awaiting:true,
    currentBet:200, roundBet:[0,100,200,200], pot:500, blinds:[100,200],
    legal:{minRaise:400}, engine:E,
  };
}
assert.equal(EV.handLabel([card('Qh'),card('9d')]), 'Q9o（オフスート）');
assert.equal(EV.handLabel([card('Qs'),card('9s')]), 'Q9s（スーテッド）');

assert.equal(EV.handLabel([card('Qh'),card('Qd')]), 'QQ（ポケットペア）');

function headsUpState(target) {
  const s = state(target);
  s.players = s.players.slice(0, 2);
  s.roundBet = [0, 200, 0, 0];
  s.players[1].stack = 19900;
  return s;
}


const openPreflop = {street:'preflop',currentBet:200,bigBlind:200,pot:500,minRaise:400};
assert.equal(BetSizing.target('small',openPreflop),500,'preflop open size uses 2.5 BB');
assert.equal(BetSizing.target('medium',openPreflop),600,'preflop open size uses 3 BB');
assert.deepEqual(BetSizing.definitions(openPreflop).map(x=>x.label),['最小','2.5 BB','3 BB','4 BB']);
const postflopBet = {street:'flop',currentBet:0,bigBlind:200,pot:900,minRaise:200};
assert.equal(BetSizing.target('small',postflopBet),300,'postflop small bet uses one third pot');
assert.equal(BetSizing.target('medium',postflopBet),450,'postflop medium bet uses half pot');
assert.equal(BetSizing.target('large',postflopBet),900,'postflop pot bet uses full pot');
assert.deepEqual(BetSizing.definitions(postflopBet).map(x=>x.label),['最小','1/3 POT','1/2 POT','POT']);
const facingRaise = {street:'turn',currentBet:1200,bigBlind:200,pot:2400,minRaise:2000};
assert.equal(BetSizing.target('small',facingRaise),3000,'re-raise target uses current bet multiple but respects minimum raise');
assert.equal(BetSizing.target('min',facingRaise),2000,'minimum re-raise respects legal minimum');
assert.deepEqual(BetSizing.definitions(facingRaise).map(x=>x.label),['最小','2.5×','3×','4×']);


const small = EV.estimate(headsUpState(400),400);
const large = EV.estimate(headsUpState(10000),10000);
assert.equal(small.status,'ok');
assert.equal(large.status,'ok');
assert(small.rows.some(r => r.name.includes('入力額でレイズ')));
assert(small.rows.some(r => r.name === 'フォールド' && r.evBB === 0));
const smallEV=small.rows.find(r=>r.name.includes('入力額でレイズ')).evBB;
const largeEV=large.rows.find(r=>r.name.includes('入力額でレイズ')).evBB;
assert.notEqual(smallEV,largeEV,'changing the selected raise target must affect the estimated EV');
assert(EV.renderMarkup(headsUpState(400),400).includes('アクション別EV'));
const multiway = EV.estimate(state(400),400);
assert.equal(multiway.raiseEVSuppressed,true,'multiway raise EV must be suppressed until caller-count-specific equity is available');
assert(!multiway.rows.some(r => r.kind === 'raise' || r.kind === 'allin'),'multiway raise/all-in values must not be shown');
const fs = require('node:fs');
const html = fs.readFileSync(require('node:path').join(__dirname, '../minigame/index.html'), 'utf8');
const js = fs.readFileSync(require('node:path').join(__dirname, '../minigame/minigame.js'), 'utf8');
assert(html.includes('./bet-sizing.js?v=20261013-betsize1'), 'contextual bet sizing module must load before the game');
assert(js.includes('updatePresetButtons(canSize)'), 'preset labels must update with the current street/action');
assert(js.includes('sizing.target(b.dataset.size,betSizingContext())'), 'preset clicks must use contextual sizing');
assert(html.includes('.actionEvDetails>summary'), 'collapsible EV disclosure must be styled');
assert(js.includes('<details id="actionEvDetails"'), 'EV panel must use native details/summary disclosure');
assert(js.includes("var actionEVOpen=false"), 'EV panel should default to collapsed');
assert(js.includes("actionEVOpen=details.open"), 'EV open state should persist across game rerenders');
console.log('✓ active mini-game EV: notation / action comparison / selected raise size / collapsible panel');

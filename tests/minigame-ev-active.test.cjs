'use strict';

const assert = require('node:assert/strict');
const E = require('../engine.js');
const EV = require('../minigame/ev.js');

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

const small = EV.estimate(state(400),400);
const large = EV.estimate(state(10000),10000);
assert.equal(small.status,'ok');
assert.equal(large.status,'ok');
assert(small.rows.some(r => r.name.includes('入力額でレイズ')));
assert(small.rows.some(r => r.name === 'フォールド' && r.evBB === 0));
const smallEV=small.rows.find(r=>r.name.includes('入力額でレイズ')).evBB;
const largeEV=large.rows.find(r=>r.name.includes('入力額でレイズ')).evBB;
assert.notEqual(smallEV,largeEV,'changing the selected raise target must affect the estimated EV');
assert(EV.renderMarkup(state(400),400).includes('アクション別EV'));
console.log('✓ active mini-game EV: Q9 notation / action comparison / selected raise size');

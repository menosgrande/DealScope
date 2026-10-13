'use strict';

const assert = require('node:assert/strict');
const E = require('../engine.js');
const EV = require('../minigame-ev.js');

function card(code) {
  const ranks = '23456789TJQKA';
  const suits = {s:0,h:1,d:2,c:3};
  return ranks.indexOf(code[0]) * 4 + suits[code[1].toLowerCase()];
}
function state(amount) {
  return {
    players: [
      {seat:0, hand:[card('Qh'),card('9d')], stack:1000, type:'tag', out:false, fold:false, allin:false},
      {seat:1, hand:[card('As'),card('Kd')], stack:1000, type:'tag', out:false, fold:false, allin:false},
      {seat:2, hand:[card('Jc'),card('Jh')], stack:1000, type:'lag', out:false, fold:false, allin:false},
      {seat:3, hand:[card('8s'),card('8d')], stack:1000, type:'tp', out:false, fold:false, allin:false},
    ],
    board:[], street:'preflop', handNo:1, actor:0, awaiting:true,
    currentBet:20, roundBet:[0,10,20,0], pot:30, blinds:[10,20], amount, engine:E,
  };
}

assert.equal(EV.handLabel([card('Qh'),card('9d')], E), 'Q9o（オフスート）');
assert.equal(EV.handLabel([card('Qs'),card('9s')], E), 'Q9s（スーテッド）');
assert.equal(EV.handLabel([card('Qh'),card('Qd')], E), 'QQ（ポケットペア）');

const small = EV.estimate(state(40));
const large = EV.estimate(state(100));
assert.equal(small.status, 'ok');
assert.equal(large.status, 'ok');
assert(small.rows.some(r => r.name === '入力額でベット／レイズ'));
assert(large.rows.some(r => r.name === '入力額でベット／レイズ'));
const smallEV = small.rows.find(r => r.name === '入力額でベット／レイズ').evBB;
const largeEV = large.rows.find(r => r.name === '入力額でベット／レイズ').evBB;
assert.notEqual(smallEV, largeEV, 'selected amount must affect the displayed EV estimate');
assert(small.rows.some(r => r.name === 'フォールド' && r.evBB === 0));
console.log('✓ mini-game EV: compact hand notation / action rows / selected bet size affects EV');

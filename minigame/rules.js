/* rules.js — mini game の状態遷移ルール（副作用なし） */
(function(root){
'use strict';
function contenders(players){return players.filter(function(p){return !p.out&&!p.fold})}
function active(players){return players.filter(function(p){return !p.out&&!p.fold&&!p.allin})}
function roundComplete(state){
 var c=contenders(state.players);
 if(c.length<=1)return true;
 return active(state.players).every(function(p){
   return state.acted[p.seat]&&state.roundBet[p.seat]===state.currentBet;
 });
}
function nextSeat(players,i){for(var k=1;k<=players.length;k++){var j=(i+k)%players.length;if(!players[j].out)return j}return i}
function nextActionSeat(players,i){for(var k=1;k<=players.length;k++){var j=(i+k)%players.length,p=players[j];if(p&&!p.out&&!p.fold&&!p.allin)return j}return -1}
function nextStreet(street){
 if(street==='preflop')return 'flop';
 if(street==='flop')return 'turn';
 if(street==='turn')return 'river';
 return null;
}
function shouldShowdown(state){return state.street==='river'&&roundComplete(state)}
function shouldFoldWin(state){return contenders(state.players).length===1}
function shouldAutoAdvance(state){return shouldFoldWin(state)||roundComplete(state)}
function allInRunout(state){return contenders(state.players).length>1&&active(state.players).length===0}
var api={contenders:contenders,active:active,roundComplete:roundComplete,nextSeat:nextSeat,nextActionSeat:nextActionSeat,nextStreet:nextStreet,shouldShowdown:shouldShowdown,shouldFoldWin:shouldFoldWin,shouldAutoAdvance:shouldAutoAdvance,allInRunout:allInRunout};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DealMiniGameRules=api;
})(typeof window!=='undefined'?window:globalThis);

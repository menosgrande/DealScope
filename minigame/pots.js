/* pots.js — mini game のポット分配(副作用なし)
 * プレイヤーの stack は変更せず、各賞金を返す。
 */
(function(root){
'use strict';
function split(pot,winners,awards,dealerSeat,seatCount){
 if(!winners.length||pot<=0)return 0;
 var ordered=winners.slice();
 if(Number.isInteger(dealerSeat)&&Number.isInteger(seatCount)&&seatCount>0){
  ordered.sort(function(a,b){
   var da=((a.seat-dealerSeat)%seatCount+seatCount)%seatCount;
   var db=((b.seat-dealerSeat)%seatCount+seatCount)%seatCount;
   // The dealer is not "left of the button"; if the dealer wins a split,
   // they are last in odd-chip priority after a full orbit.
   if(da===0)da=seatCount;
   if(db===0)db=seatCount;
   return da-db;
  });
 }
 var base=Math.floor(pot/ordered.length),rem=pot%ordered.length;
 ordered.forEach(function(p,i){awards.push({player:p,amount:base+(i<rem?1:0)});});
 return pot;
}
function settle(all,scores,deadPot,dealerSeat){
 var seatCount=all.reduce(function(max,p){return Math.max(max,(Number(p.seat)||0)+1)},0);
 deadPot=Math.max(0,Math.floor(Number(deadPot)||0));
 var levels=Array.from(new Set(all.map(function(p){return p.contrib||0}).filter(function(x){return x>0}))).sort(function(a,b){return a-b});
 var prev=0,winners=[],lastWinners=[],awards=[],unallocated=0;
 if(deadPot){
   var eligible=all.filter(function(p){return !p.fold});
   if(eligible.length){
     var best=Math.max.apply(null,eligible.map(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s}));
     var deadWinners=eligible.filter(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s===best});
     split(deadPot,deadWinners,awards,dealerSeat,seatCount);
     winners=winners.concat(deadWinners);
     lastWinners=deadWinners;
   }else unallocated=deadPot;
 }
 levels.forEach(function(level){
   var participants=all.filter(function(p){return (p.contrib||0)>=level});
   var pot=(level-prev)*participants.length;
   if(pot<=0){prev=level;return}
   var eligible=participants.filter(function(p){return !p.fold});
   if(eligible.length){
     var best=Math.max.apply(null,eligible.map(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s}));
     var w=eligible.filter(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s===best});
     if(unallocated){
       split(unallocated,lastWinners.length?lastWinners:w,awards,dealerSeat,seatCount);
       unallocated=0;
     }
     split(pot,w,awards,dealerSeat,seatCount);
     winners=winners.concat(w);
     lastWinners=w;
   }else{
     unallocated+=pot;
   }
   prev=level;
 });
 if(unallocated){
   var fallback=lastWinners.length?lastWinners:all.filter(function(p){return !p.fold});
   split(unallocated,fallback,awards,dealerSeat,seatCount);
 }
 var contributed=all.reduce(function(sum,p){return sum+(p.contrib||0)},0)+deadPot;
 var distributed=awards.reduce(function(sum,a){return sum+a.amount},0);
 if(distributed<contributed){
   var fallback=lastWinners.length?lastWinners:all.filter(function(p){return !p.fold});
   split(contributed-distributed,fallback,awards,dealerSeat,seatCount);
   distributed=awards.reduce(function(sum,a){return sum+a.amount},0);
 }
 return {
   winners:winners.length?winners:lastWinners,
   awards:awards,
   distributed:distributed,
   contributed:contributed,
   potCount:levels.length+(deadPot>0?1:0)
 };
}
var api={settle:settle};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DealMiniGamePots=api;
})(typeof window!=='undefined'?window:globalThis);

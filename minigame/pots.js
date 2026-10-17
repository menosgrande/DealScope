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
 // Return an unmatched top contribution instead of treating it as a side pot.
 // This is also required when the bettor later folded: no opponent matched it.
 var original=all.map(function(p){return Math.max(0,Math.floor(Number(p.contrib)||0))});
 var effective=original.slice(),refundAwards=[];
 var maxContrib=effective.length?Math.max.apply(null,effective):0;
 if(maxContrib>0){
   var maxIndexes=[];
   effective.forEach(function(v,i){if(v===maxContrib)maxIndexes.push(i)});
   if(maxIndexes.length===1){
     var maxIndex=maxIndexes[0];
     var secondMax=effective.reduce(function(max,v,i){return i===maxIndex?max:Math.max(max,v)},0);
     var refund=maxContrib-secondMax;
     if(refund>0){
       refundAwards.push({player:all[maxIndex],amount:refund});
       effective[maxIndex]=secondMax;
     }
   }
 }
 function contribution(p){var i=all.indexOf(p);return i<0?0:effective[i]}
 var levels=Array.from(new Set(effective.filter(function(x){return x>0}))).sort(function(a,b){return a-b});
 var prev=0,winners=[],lastWinners=[],awards=refundAwards.slice(),unallocated=0;
 if(deadPot){
   var eligible=all.filter(function(p){return !p.fold&&!p.out});
   if(eligible.length){
     var best=Math.max.apply(null,eligible.map(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s}));
     var deadWinners=eligible.filter(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s===best});
     split(deadPot,deadWinners,awards,dealerSeat,seatCount);
     winners=winners.concat(deadWinners);
     lastWinners=deadWinners;
   }else unallocated=deadPot;
 }
 levels.forEach(function(level){
   var participants=all.filter(function(p){return contribution(p)>=level});
   var pot=(level-prev)*participants.length;
   if(pot<=0){prev=level;return}
   var eligible=participants.filter(function(p){return !p.fold&&!p.out});
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
   var fallback=lastWinners.length?lastWinners:all.filter(function(p){return !p.fold&&!p.out});
   split(unallocated,fallback,awards,dealerSeat,seatCount);
 }
 var contributed=original.reduce(function(sum,v){return sum+v},0)+deadPot;
 var distributed=awards.reduce(function(sum,a){return sum+a.amount},0);
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

/* pots.js — mini game のポット分配(副作用なし)
 * プレイヤーの stack は変更せず、各賞金を返す。
 */
(function(root){
'use strict';
function split(pot,winners,awards){
 if(!winners.length||pot<=0)return 0;
 var base=Math.floor(pot/winners.length),rem=pot%winners.length;
 winners.forEach(function(p,i){awards.push({player:p,amount:base+(i<rem?1:0)});});
 return pot;
}
function settle(all,scores){
 var levels=Array.from(new Set(all.map(function(p){return p.contrib||0}).filter(function(x){return x>0}))).sort(function(a,b){return a-b});
 var prev=0,winners=[],lastWinners=[],awards=[],unallocated=0;
 levels.forEach(function(level){
   var participants=all.filter(function(p){return (p.contrib||0)>=level});
   var pot=(level-prev)*participants.length;
   if(pot<=0){prev=level;return}
   var eligible=participants.filter(function(p){return !p.fold});
   if(eligible.length){
     var best=Math.max.apply(null,eligible.map(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s}));
     var w=eligible.filter(function(p){var z=scores.find(function(x){return x.p===p});return z&&z.s===best});
     if(unallocated){
       split(unallocated,lastWinners.length?lastWinners:w,awards);
       unallocated=0;
     }
     split(pot,w,awards);
     winners=winners.concat(w);
     lastWinners=w;
   }else{
     unallocated+=pot;
   }
   prev=level;
 });
 if(unallocated){
   var fallback=lastWinners.length?lastWinners:all.filter(function(p){return !p.fold});
   split(unallocated,fallback,awards);
 }
 var contributed=all.reduce(function(sum,p){return sum+(p.contrib||0)},0);
 var distributed=awards.reduce(function(sum,a){return sum+a.amount},0);
 if(distributed<contributed){
   var fallback=lastWinners.length?lastWinners:all.filter(function(p){return !p.fold});
   split(contributed-distributed,fallback,awards);
   distributed=awards.reduce(function(sum,a){return sum+a.amount},0);
 }
 return {
   winners:winners.length?winners:lastWinners,
   awards:awards,
   distributed:distributed,
   contributed:contributed,
   potCount:levels.length
 };
}
var api={settle:settle};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DealMiniGamePots=api;
})(typeof window!=='undefined'?window:globalThis);

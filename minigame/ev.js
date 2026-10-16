/* minigame/ev.js — transparent, heuristic action-EV estimates for the mini-game.
 * This is not a GTO solver. Values are approximate BB-relative EV vs folding now.
 */
(function(root){
'use strict';
var TYPES={tag:{pressure:.55},lag:{pressure:.78},tp:{pressure:.25},lp:{pressure:.35}};
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function round1(x){return Math.round(x*10)/10}
function rankName(rank){return ({11:'J',12:'Q',13:'K',14:'A'})[rank+2]||String(rank+2)}
function handLabel(hand){
 if(!Array.isArray(hand)||hand.length!==2||hand.some(function(c){return !Number.isInteger(c)||c<0||c>51}))return 'ハンド未設定';
 var hi=Math.max(hand[0]>>2,hand[1]>>2),lo=Math.min(hand[0]>>2,hand[1]>>2);
 var a=hi+2,b=lo+2;
 function r(n){return ({11:'J',12:'Q',13:'K',14:'A'})[n]||String(n)}
 if(hi===lo)return r(a)+r(b)+'（ポケットペア）';
 var suited=(hand[0]&3)===(hand[1]&3);
 return r(a)+r(b)+(suited?'s':'o')+'（'+(suited?'スーテッド':'オフスート')+'）';
}
function foldChance(player,betSize,pot){
 var t=TYPES[player.type]||TYPES.tag;
 var ratio=betSize/Math.max(1,pot+betSize);
 return clamp(.20+ratio*.28+(.5-t.pressure)*.16,.06,.58);
}
function actionEV(eq,pot,invest,extraCallers,foldP){
 var called=eq*(pot+invest+extraCallers)-invest;
 return foldP*pot+(1-foldP)*called;
}
function estimate(state,selectedTarget){
 var hero=state.players&&state.players[0],E=state.engine;
 if(!hero||!Array.isArray(hero.hand)||hero.hand.length!==2)return {status:'ハンド情報がありません'};
 if(hero.hand.some(function(c){return !Number.isInteger(c)||c<0||c>=52}))return {status:'指定ハンドに不正なカードがあります'};
 if(!state.awaiting||state.actor!==0)return {status:'あなたのアクション待ちで表示します'};
 if(!E||typeof E.monteCarloVsRandom!=='function')return {status:'エクイティ計算エンジンを利用できません'};
 var board=(state.board||[]).filter(function(c){return c!=null&&c>=0});
 var opponents=(state.players||[]).filter(function(p){return p.seat!==0&&!p.out&&!p.fold});
 if(!opponents.length)return {status:'比較できる相手がいません'};
 var trials=board.length===0?900:650, equity, exact=false, knownHands=[];
 try{
  var seed=((state.handNo||1)*104729+board.length*7919+hero.hand[0]*53+hero.hand[1]+opponents.length*997)>>>0;
  var knownMode=state.knownHands===true;
  var validKnownOpponents=opponents.every(function(p){return Array.isArray(p.hand)&&p.hand.length===2&&p.hand.every(function(c){return Number.isInteger(c)&&c>=0&&c<52})});
  if(knownMode&&!validKnownOpponents)return {status:'指定ハンドに不正なカードがあります'};
  var canUseKnown=knownMode&&validKnownOpponents;
  if(canUseKnown){
   knownHands=[hero.hand].concat(opponents.map(function(p){return p.hand}));
   var allCards=knownHands.reduce(function(a,h){return a.concat(h)},[]).concat(board);
   if(allCards.some(function(c){return !Number.isInteger(c)||c<0||c>=52})||new Set(allCards).size!==allCards.length)return {status:'指定ハンドに重複または不正なカードがあります'};
   if(board.length>=3&&typeof E.exactSync==='function'){
    var exactResult=E.exactSync(knownHands,board);
    equity=exactResult.equity[0]/100;trials=exactResult.total;exact=true;
   }else if(typeof E.monteCarlo==='function'){
    equity=E.monteCarlo(knownHands,board,trials,{seed:seed}).equity[0]/100;
   }else return {status:'指定ハンドのエクイティ計算を利用できません'};
  }else{
   equity=E.monteCarloVsRandom(hero.hand,board,trials,{opponents:opponents.length,seed:seed}).equity[0]/100;
  }
 }catch(e){return {status:'エクイティを計算できません'}}
 if(!Number.isFinite(equity))return {status:'エクイティを計算できません'};
 var pot=Math.max(0,Number(state.pot)||0),bb=Math.max(1,Number((state.blinds||[])[1])||1);
 var roundBet=(state.roundBet&&Number(state.roundBet[0]))||0;
 var call=Math.max(0,(Number(state.currentBet)||0)-roundBet);
 var stack=Math.max(0,Number(hero.stack)||0);
 var responders=opponents.filter(function(p){return !p.allin&&p.stack>0});
 var rows=[{name:'フォールド',ev:0,kind:'fold'}];
 function eligiblePot(basePot, players, heroContributionAfter){
  // Chips committed above Hero's total hand contribution are not contestable by Hero.
  var excess=0;
  (players||[]).forEach(function(p){
   // Only contributions up to Hero's post-call total are contestable by Hero.
   // This applies to folded and all-in players too: their excess belongs to a
   // higher side pot (or is unmatched), not to the pot Hero can win.
   if(!p||p.seat===0)return;
   excess+=Math.max(0,(Number(p.contrib)||0)-heroContributionAfter);
  });
  return Math.max(0,basePot-excess);
 }
 var heroContrib=Math.max(0,Number(hero.contrib)||0);
 if(call>0){
  var callInvest=Math.min(call,stack);
  var callPot=eligiblePot(pot,state.players,heroContrib+callInvest);
  rows.push({name:'コール '+Math.round(callInvest).toLocaleString('ja-JP'),ev:equity*(callPot+callInvest)-callInvest,kind:'call'});
 }else{
  rows.push({name:'チェック',ev:equity*pot,kind:'check'});
 }
 var raiseEVSuppressed=responders.length===0||responders.length>1;
 function addBet(name,target){
  var currentBet=Math.max(0,Number(state.currentBet)||0);
  var maxTarget=roundBet+stack;
  target=Math.max(0,Math.min(maxTarget,Math.round(Number(target)||0)));
  var invest=Math.max(0,target-roundBet);
  if(target<=currentBet){
   if(invest<=0)return;
   var contestable=eligiblePot(pot,state.players,heroContrib+invest);
   rows.push({name:name+'（コール）',ev:equity*(contestable+invest)-invest,kind:'allin'});
   return;
  }
  // Multiway values are heuristic: model each responder's fold chance independently,
  // and use equity versus the current set of opponents for the called outcome.
  var ev=responders.length===1?(function(){
   var caller=responders[0],rb=(state.roundBet&&Number(state.roundBet[caller.seat]))||0;
   var chips=Math.min(Math.max(0,target-rb),Math.max(0,Number(caller.stack)||0));
   return actionEV(equity,pot,invest,chips,foldChance(caller,invest,pot));
  })():multiwayActionEV(equity,pot,invest,responders,target,state);
  rows.push({name:name,ev:ev,kind:'raise'});
 }
 var minRaise=Number(state.legal&&state.legal.minRaise)||Math.max(bb,(Number(state.currentBet)||0)+bb);
 var maxTarget=roundBet+stack;
 if(!raiseEVSuppressed&&maxTarget>(Number(state.currentBet)||0)){
  var selectedIsAllIn=false;
  if(Number.isFinite(Number(selectedTarget))&&Number(selectedTarget)>0){
   // If Hero cannot reach the normal minimum raise, the only raise-sized
   // action available may be a legal short all-in. Never label a capped
   // effective target with the larger requested slider value.
   var chosen=maxTarget<minRaise?maxTarget:clamp(Number(selectedTarget),minRaise,maxTarget);
   selectedIsAllIn=chosen>=maxTarget;
   if(selectedIsAllIn)addBet('オールイン',maxTarget);
   else addBet((call>0?'入力額でレイズ ':'入力額でベット ')+Math.round(chosen).toLocaleString('ja-JP'),chosen);
  }
  var allinTarget=maxTarget;
  if(allinTarget>0&&!selectedIsAllIn&&(!Number.isFinite(Number(selectedTarget))||Math.abs(allinTarget-Number(selectedTarget))>bb/2))addBet('オールイン',allinTarget);
 }
 return {status:'ok',hand:handLabel(hero.hand),equityPct:round1(equity*100),equityMode:state.knownHands===true&&knownHands.length?'known':'random',exact:exact,raiseEVSuppressed:raiseEVSuppressed,rows:rows.map(function(r){return {name:r.name,evBB:round1(r.ev/bb),kind:r.kind}}),trials:trials};
}
function respondersCount(state){return (state.players||[]).filter(function(p){return p.seat!==0&&!p.out&&!p.fold&&!p.allin&&Number(p.stack)>0}).length;}
function renderMarkup(state,selectedTarget){
 var r=estimate(state,selectedTarget);
 if(r.status!=='ok')return '<div class="evStatus">'+r.status+'</div>';
 var html='<div class="evHeading"><b>アクション別EV</b><span>簡易推定</span></div>';
 html+='<div class="evEquity"><span>'+(r.equityMode==='known'?'指定ハンドに対するエクイティ':'対ランダムハンドの推定エクイティ')+(r.exact?'（完全列挙）':'')+'</span><b>'+r.equityPct.toFixed(1)+'%</b></div>';
 html+='<div class="evRows"><div class="evRow evHeader"><span>アクション</span><span>EV差分</span></div>';
 r.rows.forEach(function(row){var v=row.evBB,cls=v>.04?'positive':v<-.04?'negative':'neutral';var value=(v>0?'+':v<0?'−':'±')+Math.abs(v).toFixed(1)+' BB';html+='<div class="evRow"><span>'+row.name+'</span><b class="'+cls+'">'+value+'</b></div>'});
 html+='</div>';
 if(respondersCount(state)>1)html+='<p class="evDisclaimer">複数人が応答できる場面では、推定誤差が大きいためレイズ／オールインEVを表示しません。</p>';else if(r.raiseEVSuppressed)html+='<p class="evDisclaimer">応答可能な相手がいないため、レイズ／オールインEVは表示しません。</p>';

 html+='<p class="evDisclaimer">フォールドを0 BBとした意思決定時点からの推定値。相手のコール／フォールド率は簡易モデルで、実戦結果や最適戦略を保証しません。</p>';
 return html;
}
var api={estimate:estimate,renderMarkup:renderMarkup,handLabel:handLabel};
root.DealMiniGameEV=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

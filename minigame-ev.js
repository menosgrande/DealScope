/* minigame-ev.js — Mini-game action EV estimator.
 * This is a transparent heuristic estimator, not a GTO solver.
 * EV is shown in big-blind units relative to folding at the current decision.
 */
(function(root){
'use strict';
var TYPES={
 tag:{pressure:.55},lag:{pressure:.78},tp:{pressure:.25},lp:{pressure:.35}
};
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function round1(x){return Math.round(x*10)/10}
function handLabel(hand,E){
 if(!hand||hand.length!==2)return 'ハンド未設定';
 var r=hand.map(function(c){return c>>2}).sort(function(a,b){return b-a});
 var high=r[0]+2,low=r[1]+2,suited=(hand[0]&3)===(hand[1]&3),gap=r[0]-r[1];
 var rankName=function(n){return ({11:'J',12:'Q',13:'K',14:'A'})[n]||String(n)};
 if(r[0]===r[1])return rankName(high)+'のポケットペア';
 var shape=suited?'スーテッド':'オフスート';
 if(gap===1)return shape+'・コネクター・'+rankName(high)+'ハイ';
 if(gap===2)return shape+'・ワンギャッパー・'+rankName(high)+'ハイ';
 return shape+'・'+rankName(high)+'ハイ / '+rankName(low)+'ハイ';
}
function streetLabel(street){
 return ({preflop:'フロップ待ち',flop:'フロップ',turn:'ターン',river:'リバー'})[street]||'ボード未確定';
}
function sampleEquity(state,opponents){
 var E=state.engine,hero=state.players[0],board=state.board.filter(function(c){return c>=0});
 if(!E||!hero||!hero.hand||hero.hand.length!==2)return null;
 try{
  var trials=state.street==='preflop'?900:650;
  var result=E.monteCarloVsRandom(hero.hand,board,Math.max(1,trials),{
   opponents:Math.max(1,opponents),
   seed:((state.handNo||1)*104729+(state.actor||0)*13007+board.length*7919+hero.hand[0]*53+hero.hand[1])>>>0
  });
  return result.equity[0]/100;
 }catch(e){return null}
}
function foldProbability(opponents,betSize,pot){
 if(!opponents.length)return 0;
 var ratio=betSize/Math.max(1,pot+betSize),allFold=1;
 opponents.forEach(function(p){
  var t=TYPES[p.type]||TYPES.tag;
  // Personality-based rough response model; not learned or solver-derived.
  var fold=clamp(.20+ratio*.28+(0.5-t.pressure)*.16,.06,.58);
  allFold*=fold;
 });
 return clamp(allFold,0,.9);
}
function actionValue(eq,pot,invest,opponentCall,foldP){
 var called=eq*(pot+invest+opponentCall)-invest;
 return foldP*pot+(1-foldP)*called;
}
function estimate(state){
 var p=state.players&&state.players[0];
 if(!p||!p.hand||p.hand.length!==2)return {status:'ハンド情報がありません'};
 if(!state.awaiting||state.actor!==0)return {status:'あなたのアクション待ちで分析できます'};
 var opponents=state.players.filter(function(q){return q.seat!==0&&!q.out&&!q.fold});
 var responders=opponents.filter(function(q){return !q.allin&&q.stack>0});
 var equity=sampleEquity(state,Math.max(1,opponents.length));
 if(equity===null)return {status:'エクイティを計算できません'};
 var pot=Math.max(0,state.pot),bb=Math.max(1,state.blinds[1]||1);
 var call=Math.max(0,state.currentBet-(state.roundBet[0]||0));
 var maxInvest=Math.max(0,p.stack);
 var rows=[{name:'フォールド',ev:0,kind:'fold'}];
 if(call===0){
  rows.push({name:'チェック',ev:equity*pot,kind:'check'});
 }else{
  var callInvest=Math.min(call,maxInvest);
  rows.push({name:'コール',ev:actionValue(equity,pot,callInvest,0,0),kind:'call'});
 }
 function addRaise(name,multiplier){
  var target;
  if(state.currentBet>0)target=state.currentBet*multiplier;
  else target=Math.max(bb,Math.round(pot*(multiplier===2?.5:1)));
  target=Math.min((state.roundBet[0]||0)+maxInvest,Math.max(state.currentBet+bb,target));
  var invest=Math.min(maxInvest,Math.max(0,target-(state.roundBet[0]||0)));
  var actualTarget=(state.roundBet[0]||0)+invest;
  var opponentCall=Math.max(0,actualTarget-state.currentBet);
  var foldP=foldProbability(responders,invest,pot);
  rows.push({name:name,ev:actionValue(equity,pot,invest,opponentCall,foldP),kind:'raise'});
 }
 if(call===0){addRaise('ベット ×0.5 pot',2);addRaise('ベット ×1 pot',3)}
 else{addRaise('×2 レイズ',2);addRaise('×3 レイズ',3)}
 var allinInvest=maxInvest;
 var allinTarget=(state.roundBet[0]||0)+allinInvest;
 var allinCall=Math.max(0,allinTarget-state.currentBet);
 var allinFold=foldProbability(responders,allinInvest,pot);
 rows.push({name:'オールイン',ev:actionValue(equity,pot,allinInvest,allinCall,allinFold),kind:'allin'});
 rows=rows.map(function(r){return {name:r.name,evBB:round1(r.ev/bb),kind:r.kind}});
 return {
  status:'ok',
  hand:handLabel(p.hand,state.engine),
  board:streetLabel(state.street),
  equityPct:round1(equity*100),
  rows:rows,
  note:'簡易推定EV・ランダムハンド相手モデル。GTO解ではありません。',
  trials:state.street==='preflop'?900:650
 };
}
function render(state){
 var box=document.getElementById('handAnalysisContent');
 if(!box)return;
 if(!document.getElementById('handAnalysis').open){
  return;
 }
 var result=estimate({players:state.players,board:state.board,street:state.street,handNo:state.handNo,actor:state.actor,awaiting:state.awaiting,currentBet:state.currentBet,roundBet:state.roundBet,pot:state.pot,blinds:state.blinds,engine:root.PokerEq});
 if(result.status!=='ok'){
  box.innerHTML='<p class="evStatus">'+result.status+'</p>';
  return;
 }
 var html='<div class="evMeta"><span>スタートハンド</span><b>'+result.hand+'</b></div>';
 html+='<div class="evMeta"><span>ボード</span><b>'+result.board+'</b></div>';
 html+='<div class="evMeta"><span>現在のエクイティ（推定）</span><b>'+result.equityPct.toFixed(1)+'%</b></div>';
 html+='<div class="evRows"><div class="evRow evHeader"><span>アクション</span><span>EV差分</span></div>';
 result.rows.forEach(function(row){
  var v=row.evBB,cls=v>0.04?'positive':v<-.04?'negative':'neutral';
  var label=(v>0?'+':v<0?'−':'±')+Math.abs(v).toFixed(1)+' BB';
  html+='<div class="evRow"><span>'+row.name+'</span><b class="'+cls+'">'+label+'</b></div>';
 });
 html+='</div><p class="evDisclaimer">'+result.note+' EVはフォールドを0 BBとした意思決定時点からの推定値です。相手の応答確率は簡易モデルです。</p>';
 box.innerHTML=html;
}
root.MiniGameEV={estimate:estimate,render:render,handLabel:handLabel,streetLabel:streetLabel};
})(typeof window!=='undefined'?window:globalThis);

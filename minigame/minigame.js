/* minigame.js — DealScope 4人トーナメント mini game
 * Calculatorとは分離。共有するのは engine.js の役評価のみ。
 * CPUはGTO solverではなく、TAG/LAG/TP/LPの傾向を確率パラメータ化したゲームAI。
 */
(function(){
'use strict';
var E=window.PokerEq, R=E.RANKS, S=E.SUITS, Rules=window.DealMiniGameRules;
var TYPES={
 tag:{name:'冷静なプロ',short:'TAG',vpip:0.20,raise:0.62,call:0.22,bluff:0.08,pressure:0.55,post:0.72},
 lag:{name:'攻める狂犬',short:'LAG',vpip:0.42,raise:0.70,call:0.18,bluff:0.25,pressure:0.78,post:0.82},
 tp:{name:'慎重派',short:'TP',vpip:0.14,raise:0.30,call:0.48,bluff:0.03,pressure:0.25,post:0.42},
 lp:{name:'お人よし',short:'LP',vpip:0.43,raise:0.22,call:0.64,bluff:0.12,pressure:0.35,post:0.50}
};
var NAMES=['あなた','攻める狂犬','慎重派','お人よし'];
var TYPE_TONES={tag:'堅実',lag:'攻める',tp:'慎重',lp:'コール多め'};
var COLORS=['#d8b252','#6f8bd8','#d17a70','#72aa8b'];
var A={players:[],deck:[],board:[],dealer:3,handNo:0,blinds:[100,200],street:'preflop',currentBet:0,lastRaise:200,actor:0,acted:[],roundBet:[],pot:0,history:[],message:'',awaiting:false,finished:false,handOver:false,awards:[],raiseLocked:[false,false,false,false],epoch:0,pending:false};
var equityCache=Object.create(null),equityJobs=Object.create(null),EQUITY_TRIALS=4096;
function equityKey(seat){
 var p=A.players[seat],opponents=contenders().filter(function(q){return q.seat!==seat}).length;
 return [A.handNo,seat,p.hand.join(','),A.board.join(','),opponents].join('|')
}
function equityEligible(seat,p){
 return !A.handOver&&!p.out&&!p.fold&&p.hand.length===2&&contenders().some(function(q){return q.seat===seat})&&contenders().filter(function(q){return q.seat!==seat}).length>0
}
function equityHandText(p){
 if(p.showdownScore)return handDetail(p.showdownScore);
 if(A.board.length>=3&&p.hand.length===2)return handDetail(E.evaluate(A.board.concat(p.hand)));
 return 'プレフロップ（役未確定）'
}
function equityDetailLines(p){
 var hand=p.hand||[],board=A.board||[];
 if(board.length===0){
  var traits=[];
  if(hand.length===2){
   var a=rank(hand[0]),b=rank(hand[1]),hi=Math.max(a,b),lo=Math.min(a,b);
   if(a===b)traits.push('ポケットペア');
   if((hand[0]&3)===(hand[1]&3))traits.push('スーテッド');
   if(hi-lo===1)traits.push('コネクター');
   else if(hi-lo===2)traits.push('ワンギャップ');
   traits.push(rankLabel(hi)+'ハイ');
  }
  return [{label:'ハンド',value:traits.join(' ・ ')||'—'},{label:'ボード',value:'未公開'}]
 }
 var known=hand.concat(board),rankCount={},suitCount=[0,0,0,0],boardRankCount={},boardSuitCount=[0,0,0,0];
 known.forEach(function(c){rankCount[rank(c)]=(rankCount[rank(c)]||0)+1;suitCount[c&3]++});
 board.forEach(function(c){boardRankCount[rank(c)]=(boardRankCount[rank(c)]||0)+1;boardSuitCount[c&3]++});
 var draw=[];
 if(board.length<5){
  var flushSuit=-1;
  for(var s=0;s<4;s++)if(suitCount[s]>=4){flushSuit=s;break}
  if(flushSuit>=0)draw.push('フラッシュ '+(13-suitCount[flushSuit])+'アウト');
  var present=Object.create(null);
  known.forEach(function(c){present[rank(c)]=true});
  var patterns=[];
  for(var base=0;base<=8;base++)patterns.push([base,base+1,base+2,base+3,base+4]);
  patterns.push([12,0,1,2,3]);
  var missing=Object.create(null),edge=Object.create(null),inside=Object.create(null);
  patterns.forEach(function(seq){
   var miss=seq.filter(function(r){return !present[r]});
   if(miss.length===1){missing[miss[0]]=true;if(miss[0]===seq[0]||miss[0]===seq[4])edge[miss[0]]=true;else inside[miss[0]]=true}
  });
  var missRanks=Object.keys(missing).map(Number),outs=missRanks.reduce(function(n,r){return n+Math.max(0,4-(rankCount[r]||0))},0);
  if(missRanks.length){
   var edgeCount=Object.keys(edge).length;
   var kind=edgeCount>=2?'オープンエンド':inside[missRanks[0]]?'ガットショット':'ストレート候補';
   draw.push(kind+' '+outs+'アウト候補');
  }
  if(!draw.length)draw.push('目立ったドローなし');
 }else draw.push('リバー（追加カードなし）');
 var boardInfo=[];
 if(board.length===3)boardInfo.push('フロップ');
 else if(board.length===4)boardInfo.push('ターン');
 else boardInfo.push('リバー');
 if(Object.keys(boardRankCount).some(function(r){return boardRankCount[r]>=2}))boardInfo.push('ペアあり');
 var maxBoardSuit=Math.max.apply(null,boardSuitCount);
 if(maxBoardSuit>=3)boardInfo.push('同スート'+maxBoardSuit+'枚');
 return [{label:'現在の役',value:equityHandText(p)},{label:'ドロー',value:draw.join(' / ')},{label:'ボード',value:boardInfo.join(' ・ ')}]
}
function equityDetailMarkup(p){
 return '<div class="equityInfo"><div class="equityInfoHeading">HAND DETAILS</div>'+equityDetailLines(p).map(function(item){return '<div class="equityInfoLine"><span>'+item.label+'</span><b>'+item.value+'</b></div>'}).join('')+'</div>'
}
function equityBodyMarkup(seat,p,key){
 var opponents=contenders().filter(function(q){return q.seat!==seat}).length;
 if(p.out)return '<div class="equityMessage">トーナメントから脱落しています。</div>';
 if(p.fold)return '<div class="equityMessage">このHandはフォールド済みです。</div>';
 if(A.handOver){var won=A.awards.some(function(a){return a.seat===seat});return '<div class="equityMessage">'+(won?'このHandで勝利しました。':'このHandは終了しました。')+'</div><div class="equityHand">'+(p.showdownScore?'役：'+handDetail(p.showdownScore):'結果を確認できます')+'</div>'}
 if(!equityEligible(seat,p))return '<div class="equityMessage">現在は推定できません。</div>';
 var cached=equityCache[key],right;
 if(!cached)right='<div class="equityAside"><div class="equityAsideLabel">推定エクイティ</div><b class="equityPct" data-equity-result="'+seat+'">…</b><div class="equityPending">'+(equityJobs[key]?'計算中…':'展開して計算')+'</div></div>';
 else{
  var pct=cached.equity[0];
  right='<div class="equityAside"><div class="equityAsideLabel">推定エクイティ</div><b class="equityPct" data-equity-result="'+seat+'">'+pct.toFixed(1)+'%</b><div class="equityBar" aria-label="推定エクイティ '+pct.toFixed(1)+'%"><i style="width:'+Math.max(0,Math.min(100,pct)).toFixed(1)+'%"></i></div><div class="equityMeta">相手'+opponents+'人・'+money(cached.trials)+'試行</div></div>'
 }
 return '<div class="equityBody">'+equityDetailMarkup(p)+right+'</div>'
}
function heroAnalysisMarkup(){
 var p=A.players[0];
 if(!p)return '<div class="analysisTitle"><span>YOUR PLAYER</span><b>ハンド分析</b></div>';
 return '<div class="analysisTitle"><span>YOUR PLAYER</span><b>ハンド分析</b></div>'+equityBodyMarkup(0,p,equityKey(0))
}
function queueEquity(seat){
 if(seat!==0)return;
 var p=A.players[seat],key=equityKey(seat);
 if(!equityEligible(seat,p)||equityCache[key]||equityJobs[key])return;
 var opponents=contenders().filter(function(q){return q.seat!==seat}).length;
 var gen=E.monteCarloVsRandomGen(p.hand.slice(),A.board.slice(),opponents,EQUITY_TRIALS);
 equityJobs[key]=true;
 function step(){
  if(equityKey(seat)!==key||!equityEligible(seat,A.players[seat])){delete equityJobs[key];return}
  var next=gen.next();
  if(!next.done){window.setTimeout(step,0);return}
  equityCache[key]=next.value;delete equityJobs[key];render()
 }
 window.setTimeout(step,0)
}
var seed=(Date.now()^Math.floor(Math.random()*4294967295))>>>0;
function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296}
function $(id){return document.getElementById(id)}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function money(n){return Math.round(n).toLocaleString('ja-JP')}
function shuffle(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(rnd()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a}
function alive(){return A.players.filter(function(p){return !p.out})}
function active(){return Rules.active(A.players)}
function contenders(){return Rules.contenders(A.players)}
function nextSeat(i){return Rules.nextSeat(A.players,i)}
function nextActionSeat(i){return Rules.nextActionSeat(A.players,i)}
function cardName(c){return R[c>>2]+S[c&3]}
function scoreLabel(s){return ['ハイカード','ワンペア','ツーペア','スリーカード','ストレート','フラッシュ','フルハウス','フォーカード','ストレートフラッシュ'][s>>>20]||''}
function rankLabel(r){return R[r]||''}
function handDetail(s){var cat=s>>>20,a=(s>>>16)&15,b=(s>>>12)&15;switch(cat){case 8:return rankLabel(a)+'ハイ・ストレートフラッシュ';case 7:return rankLabel(a)+'のフォーカード';case 6:return rankLabel(a)+'のフルハウス（'+rankLabel(b)+'のペア）';case 5:return rankLabel(a)+'ハイ・フラッシュ';case 4:return rankLabel(a)+'ハイ・ストレート';case 3:return rankLabel(a)+'のスリーカード';case 2:return rankLabel(a)+'と'+rankLabel(b)+'のツーペア';case 1:return rankLabel(a)+'のワンペア';default:return rankLabel(a)+'ハイ'}}
function rank(c){return c>>2}
function preStrength(h){
 var a=rank(h[0]),b=rank(h[1]),hi=Math.max(a,b),lo=Math.min(a,b),pair=a===b,g=hi-lo,x;
 if(pair)x=0.55+hi*0.035; else{x=0.18+hi*0.035+lo*0.018+((h[0]&3)===(h[1]&3)?0.07:0);if(g===1)x+=0.06;if(g===2)x+=0.025;if(hi>=10&&lo>=8)x+=0.08;if(hi===12)x+=0.08}
 return clamp(x,0,1)
}
function texture(){
 var r=A.board.filter(function(c){return c>=0}),rs=r.map(rank),ss=r.map(function(c){return c&3}),u=Array.from(new Set(rs)),x=0;
 if(u.length<rs.length)x+=0.08;
 for(var s=0;s<4;s++)if(ss.filter(function(v){return v===s}).length>=3)x+=0.12;
 u.sort(function(a,b){return a-b});for(var i=0;i<u.length-1;i++)if(u[i+1]-u[i]<=2)x+=0.04;
 return clamp(x,0,0.35)
}
function equity(p){
 var b=A.board.filter(function(c){return c>=0});
 if(!b.length)return preStrength(p.hand);
 try{return E.monteCarloVsRandom(p.hand,b,360,{seed:((A.handNo+1)*10007+p.seat*7919+(seed>>>0))>>>0}).equity[0]/100}catch(e){return 0.5}
}
function minRaise(){return A.currentBet===0?A.blinds[1]:A.currentBet+Math.max(A.blinds[1],A.lastRaise||A.blinds[1])}
function legalActions(p){
 var r={fold:false,check:false,call:false,bet:false,raise:false,allin:false,callAmount:0,minRaise:minRaise(),max:p?p.stack+A.roundBet[p.seat]:0};
 if(!p||p.out||p.fold||p.allin)return r;
 r.callAmount=Math.max(0,A.currentBet-A.roundBet[p.seat]);
 r.check=r.callAmount===0;
 r.fold=r.callAmount>0;
 r.call=r.callAmount>0&&p.stack>0;
 r.allin=p.stack>0;
 if(r.callAmount===0)r.bet=p.stack>=A.blinds[1];
 else r.raise=!A.raiseLocked[p.seat]&&r.max>=r.minRaise;
 return r;
}
function amount(p,n){var max=p.stack+A.roundBet[p.seat];return Math.min(max,Math.max(0,Math.floor(n/A.blinds[1])*A.blinds[1]))}
function ai(p){
 var t=TYPES[p.type],eq=equity(p),pre=preStrength(p.hand),call=Math.max(0,A.currentBet-A.roundBet[p.seat]),stack=p.stack+A.roundBet[p.seat],spr=stack/Math.max(A.blinds[1],A.pot),odds=call>0?call/(A.pot+call):0,tex=texture();
 var pos=p.position,late=(pos==='BTN'||pos==='CO'),early=(pos==='UTG'),v=clamp(eq*0.62+pre*0.38+(rnd()-0.5)*0.10,0,1);
 var streetFactor=A.street==='preflop'?1:A.street==='flop'?1.04:A.street==='turn'?1.08:1.12;
 var strong=v*streetFactor, pressure=(t.pressure||0.5)*(late ? 1.08 : (early ? 0.88 : 1));
 var callCost=call/Math.max(1,stack),short=spr<12,veryShort=spr<7;
 var bluff=t.bluff*(late ? 1.25 : (early ? 0.65 : 1))*(A.street==='preflop' ? 1 : (A.street==='flop' ? 0.9 : 0.72));
 if(veryShort && strong>0.68 && rnd()<72/100)return{a:'allin'};
 if(call>0 && callCost>30/100 && strong<0.58 && rnd()>bluff*12/10)return{a:'fold'};
 if(call>0 && strong<43/100 && rnd()>bluff*8/10)return{a:'fold'};
 if(call>0 && strong<52/100 && odds>0.28 && rnd()<t.call*75/100)return{a:'call'};
 if(call>=stack)return strong>=0.72||rnd()<bluff*18/100?{a:'allin'}:{a:'fold'};
 if(!call){
   if(A.street==='preflop'&&p.position==='BB'&&rnd()<0.35&&v<0.38)return{a:'check'};
   if(v<0.25&&rnd()>t.bluff)return{a:'check'};
   if(rnd()<clamp(t.post*(v-0.32)*1.5,0,0.8)){
     var openSize=Math.max(A.blinds[1]*2.2,A.blinds[1]*clamp(2.1+strong*0.9+(late ? 0.25 : 0),2.1,3.4));
     openSize=Math.min(openSize,Math.max(A.blinds[1]*2.2,stack*0.18));
     return{a:'bet',n:amount(p,openSize)};
   }
   return{a:'check'}
 }
 if(v<odds-0.08&&rnd()>t.bluff*0.35)return{a:'fold'};
 if(v>0.70&&rnd()<t.raise*0.55){
   var min=minRaise(),raiseMult=clamp(0.9+strong*0.65+(pressure-0.5)*0.25,0.9,1.65),target=Math.max(min,A.currentBet+Math.max(A.lastRaise,A.blinds[1])*raiseMult);
   target=Math.min(target,Math.max(min,stack*0.35));
   if(target> A.currentBet && strong>0.84 && rnd()<0.10)return{a:'allin'};
   if(target>A.currentBet)return{a:'raise',n:amount(p,target)};
 }
 if(v>0.52&&rnd()<t.bluff*0.12){
   var bluffTarget=Math.min(stack*0.28,Math.max(minRaise(),A.currentBet+A.blinds[1]*2));
   return{a:'raise',n:amount(p,bluffTarget)};
 }
 return rnd()<t.call||v>odds?{a:'call'}:{a:'fold'}
}
function initDeck(){A.deck=shuffle(Array.from({length:52},function(_,i){return i}))}
function deal(){return A.deck.pop()}
function blind(p,n){var x=Math.min(n,p.stack);p.stack-=x;p.contrib=x;A.roundBet[p.seat]=x;A.pot+=x;if(!p.stack)p.allin=true}
function contribute(p,n){n=Math.max(0,Math.min(n,p.stack));p.stack-=n;A.roundBet[p.seat]+=n;p.contrib=(p.contrib||0)+n;A.pot+=n;if(!p.stack)p.allin=true;return n}
function resetHand(){
 if(alive().length<=1){finish();return}
 A.handNo++;A.epoch++;A.pending=false;
 if(A.handNo>1&&A.handNo%8===1){var next=[200,300,400,600,800,1200,1600,2400,3200,4800,6400],i=Math.min(Math.floor((A.handNo-1)/8),next.length-1);A.blinds=[next[i]/2,next[i]]}
 A.dealer=nextSeat(A.dealer);A.board=[];A.street='preflop';A.currentBet=0;A.lastRaise=A.blinds[1];A.pot=0;A.acted=[false,false,false,false];A.roundBet=[0,0,0,0];A.raiseLocked=[false,false,false,false];A.history=[];A.awards=[];A.handOver=false;initDeck();
 A.players.forEach(function(p){p.hand=[];p.fold=false;p.allin=false;p.contrib=0;p.showdownScore=0});
 for(var k=0;k<2;k++)for(var j=0;j<4;j++){var p=A.players[(A.dealer+j)%4];if(!p.out)p.hand.push(deal())}
 var sb=nextSeat(A.dealer),bb=nextSeat(sb);
 blind(A.players[sb],A.blinds[0]);blind(A.players[bb],A.blinds[1]);A.currentBet=A.roundBet[bb];
 A.players.forEach(function(p){p.position=p.seat===A.dealer?'BTN':p.seat===sb?'SB':p.seat===bb?'BB':'UTG'});
 A.actor=nextSeat(bb);A.message='Hand #'+A.handNo+' / Blinds '+money(A.blinds[0])+'/'+money(A.blinds[1]);render();advance()
}
function roundDone(){return Rules.roundComplete(A)}
function act(seat,a,n){
 var p=A.players[seat];if(p.out||p.fold||p.allin)return false;
 var call=Math.max(0,A.currentBet-A.roundBet[seat]),text='';
 if(a==='fold'){if(call===0)return false;p.fold=true;text='フォールド'}
 else if(a==='check'){if(call)return false;text='チェック'}
 else if(a==='call'){var paid=Math.min(call,p.stack);contribute(p,paid);text=call?'コール'+(paid<call?'（オールイン）':''):'チェック'}
 else if(a==='bet'){
   if(A.currentBet)return false;n=Math.min(p.stack,Math.max(A.blinds[1],n||A.blinds[1]));contribute(p,n);A.currentBet=A.roundBet[seat];A.lastRaise=n;A.acted=A.players.map(function(q){return q.out||q.fold||q.allin});A.acted[seat]=true;text='ベット '+money(n)
 }else if(a==='raise'){
   var min=minRaise(),target=Math.min(p.stack+A.roundBet[seat],Math.max(min,n||min)),add=target-A.roundBet[seat];
   if(add<=call)return false;var rb=target-A.currentBet,prevRaise=A.lastRaise;contribute(p,add);A.currentBet=target;if(rb>=prevRaise){A.lastRaise=rb;A.acted=A.players.map(function(q){return q.out||q.fold||q.allin});A.raiseLocked=A.players.map(function(){return false})}else{A.raiseLocked=A.players.map(function(q,i){return A.acted[i]||q.out||q.fold||q.allin})}A.acted[seat]=true;text='レイズ '+money(target)
 }else if(a==='allin'){
   var target2=A.roundBet[seat]+p.stack,before=A.currentBet,prevRaise=A.lastRaise;contribute(p,p.stack);
   if(target2>before){var rb2=target2-before;A.currentBet=target2;if(rb2>=prevRaise){A.lastRaise=rb2;A.acted=A.players.map(function(q){return q.out||q.fold||q.allin});A.raiseLocked=A.players.map(function(){return false})}else{A.raiseLocked=A.players.map(function(q,i){return A.acted[i]||q.out||q.fold||q.allin})}A.acted[seat]=true}
   text=target2>before?'オールイン':'オールイン（コール）'
 }
 if(!text)return false;
 A.acted[seat]=true;A.history.push({seat:seat,text:text});A.actor=nextActionSeat(seat);render();return true
}
function street(){
 if(A.street==='preflop'){A.deck.pop();A.board.push(deal(),deal(),deal());A.street='flop'}
 else if(A.street==='flop'){A.deck.pop();A.board.push(deal());A.street='turn'}
 else if(A.street==='turn'){A.deck.pop();A.board.push(deal());A.street='river'}
 else{return}
 A.currentBet=0;A.lastRaise=A.blinds[1];A.roundBet=[0,0,0,0];A.raiseLocked=[false,false,false,false];A.acted=A.players.map(function(p){return p.out||p.fold||p.allin});A.actor=nextActionSeat(A.dealer);A.message=A.street==='flop'?'Flop':A.street==='turn'?'Turn':'River';render();advance()
}
function foldWin(){
 var c=contenders();if(c.length!==1)return false;var p=c[0],won=A.pot;
 p.stack+=won;A.awards=[{seat:p.seat,amount:won}];
 A.message=p.name+' が勝利（他のプレイヤーがフォールド）・'+money(won)+'獲得';A.pot=0;endHand();return true
}
function showdown(){
 var b=A.board,all=A.players.filter(function(p){return !p.out}),scores=all.map(function(p){return{p:p,s:E.evaluate(p.hand.concat(b))}});
 A.players.forEach(function(p){var z=scores.find(function(x){return x.p===p});p.showdownScore=z?z.s:0});
 var settlement=window.DealMiniGamePots.settle(all,scores);
 settlement.awards.forEach(function(a){a.player.stack+=a.amount});
 var awardMap={};settlement.awards.forEach(function(a){awardMap[a.player.seat]=(awardMap[a.player.seat]||0)+a.amount});
 A.awards=Object.keys(awardMap).map(function(seat){return{seat:Number(seat),amount:awardMap[seat]}});
 var unique=[];settlement.winners.forEach(function(p){if(unique.indexOf(p)<0)unique.push(p)});
 var total=all.reduce(function(s,p){return s+(p.contrib||0)},0),winnerText=unique.map(function(p){var z=scores.find(function(x){return x.p===p});return p.name+'「'+handDetail(z.s)+'」'}).join(' / ');A.message=unique.length===1?'勝者：'+winnerText+'・'+money(total)+'獲得':'引き分け：'+winnerText+'・'+money(total)+'を分配';
 A.pot=0;endHand()
}
function endHand(){
 A.players.forEach(function(p){p.contrib=0;p.roundBet=0;p.allin=false});A.handOver=true;A.awaiting=false;render()
}
function nextHand(){
 if(!A.handOver||A.finished)return;
 A.handOver=false;A.epoch++;A.pending=false;
 A.players.forEach(function(p){if(p.stack<=0)p.out=true});
 if(alive().length<=1)finish();else resetHand();
}
function finish(){A.finished=true;var w=alive()[0];A.message=w?w.name+' の優勝！':'ゲーム終了';render()}
function fallbackCpuAction(p){
 var legal=legalActions(p);
 if(legal.check)return{a:'check'};
 if(legal.call)return{a:'call'};
 if(legal.allin)return{a:'allin'};
 return{a:'fold'};
}
function advance(){
 if(A.finished||A.handOver)return;
 if(foldWin())return;
 if(roundDone()){if(A.street==='river')showdown();else street();return}
 var seat=A.actor;
 if(seat<0||!A.players[seat]||A.players[seat].out||A.players[seat].fold||A.players[seat].allin){
   seat=nextActionSeat(A.players,seat<0?A.dealer:seat);
   A.actor=seat;
   if(seat<0){if(Rules.allInRunout(A)){if(A.street==='river')showdown();else street();}return}
 }
 var p=A.players[seat];
 if(!p||p.out||p.fold||p.allin){A.actor=nextActionSeat(A.players,seat);advance();return}
 /* 同じベット額まで既に投入済みで行動済みの席には、同一ラウンドで再度ターンを渡さない。 */
 if(A.acted[p.seat]&&A.roundBet[p.seat]===A.currentBet){
   A.actor=nextActionSeat(A.players,seat);
   if(A.actor!==-1)advance();
   return;
 }
 if(p.seat===0){A.awaiting=true;A.pending=false;render();return}
 A.awaiting=false;
 if(A.pending)return;
 A.pending=true;
 var epoch=A.epoch,handNo=A.handNo,actor=seat;
 setTimeout(function(){
   if(A.finished||A.handOver||A.epoch!==epoch||A.handNo!==handNo||A.actor!==actor){A.pending=false;return}
   var cpu=A.players[actor];
   if(!cpu||cpu.out||cpu.fold||cpu.allin){A.pending=false;advance();return}
   var d=ai(cpu);
   if(d.a==='raise'&&A.raiseLocked[cpu.seat])d={a:(A.currentBet>A.roundBet[cpu.seat]?'call':'check')};
   var ok=act(cpu.seat,d.a,d.n);
   if(!ok)ok=act(cpu.seat,(fallbackCpuAction(cpu)).a,(fallbackCpuAction(cpu)).n);
   A.pending=false;
   if(!ok){
     cpu.fold=true;
     A.history.push({seat:cpu.seat,text:'フォールド（自動処理）'});
     A.actor=nextActionSeat(A.players,cpu.seat);
     render();
   }
   advance();
 },460)
}
function human(a){
 if(!A.awaiting||A.actor!==0||A.finished)return;
 var p=A.players[0],n=Number($('amount').value)||0,legal=legalActions(p);
 if(!legal[a])return;
 if((a==='bet'||a==='raise')&&!act(0,a,n))return;
 if(a!=='bet'&&a!=='raise'&&!act(0,a,n))return;
 A.awaiting=false;advance()
}
function restart(){
 A.players=[];A.finished=false;A.handNo=0;A.dealer=3;A.blinds=[100,200];A.pot=0;
 ['tag','lag','tp','lp'].forEach(function(t,i){A.players.push({seat:i,name:NAMES[i],type:t,stack:20000,out:false,hand:[],fold:false,allin:false})});
 resetHand()
}
function card(c){var suit=c&3,cls=['spade','heart','diamond','club'][suit];return '<span class="card '+cls+'"><span class="rank">'+R[c>>2]+'</span><span class="suit">'+S[suit]+'</span></span>'}
function render(){
 $('msg').textContent=A.message||'';$('street').textContent=A.street==='preflop'?'PREFLOP':A.street.toUpperCase();$('info').textContent='Hand #'+A.handNo+'　Blinds '+money(A.blinds[0])+'/'+money(A.blinds[1]);
 var chipCount=A.pot<=0?0:Math.min(10,Math.max(1,Math.ceil(Math.log2(A.pot/Math.max(1,A.blinds[1])+1)*2)));$('potValue').textContent=money(A.pot);$('potChips').innerHTML=Array.from({length:chipCount},function(_,i){return '<span class="chip" style="bottom:'+(i*3)+'px"></span>'}).join('');
 $('board').innerHTML=A.board.map(card).join('')||'<span class="empty">—</span>';
 $('players').innerHTML=A.players.map(function(p){
   var st=p.out?'脱落':p.fold?'フォールド':p.allin?'オールイン':p.seat===A.actor&&!A.handOver?'行動中':'';
   var hide=p.seat!==0&&(!A.handOver||p.fold);
   var award=A.awards.find(function(a){return a.seat===p.seat});
   var tone=p.seat===0?'':('<span class="typeTag">'+(TYPE_TONES[p.type]||'')+'</span>');
   var badge=award?'<span class="resultBadge">+'+money(award.amount)+'</span>':'';
   var bet=A.roundBet[p.seat]||0,chipCount=bet<=0?0:Math.min(5,Math.max(1,Math.ceil(Math.log2(bet/Math.max(1,A.blinds[1]/2)+1))));
   var placedChips=chipCount?'<span class="betChips" aria-label="このストリートの投入チップ">'+Array.from({length:chipCount},function(){return '<span class="betChip"></span>'}).join('')+'</span>':'';
   return '<section class="player '+(p.seat===0?'hero ':'')+(p.out?' out ':'')+(award?'winner ':'')+(p.seat===A.actor&&!A.handOver?'current':'')+'"><div class="phead"><i style="background:'+COLORS[p.seat]+'"></i><b>'+p.name+'</b>'+tone+(p.seat===A.dealer?'<span class="dealerMark">D</span>':'')+'<small>'+(p.position?'<b>'+p.position+'</b> ・ ':'')+st+'</small>'+badge+'</div><div class="cards">'+(hide?'<span class="cardBack">◆</span><span class="cardBack">◆</span>':p.hand.map(card).join(' '))+'</div><div class="sideInfo"><div class="stack"><span class="sideLabel">所持</span><b>'+money(p.stack)+'</b></div><div class="betline">'+placedChips+'<span class="potLabel">POT <b>'+money(bet)+'</b></span></div></div>'+(p.showdownScore&&A.handOver?'<div class="made">'+handDetail(p.showdownScore)+'</div>':'')+'</section>'
  }).join('');
  $('heroAnalysis').innerHTML=heroAnalysisMarkup();
  queueEquity(0);
  $('log').innerHTML=A.history.slice(-7).map(function(h){return '<div><b>'+A.players[h.seat].name+'</b> '+h.text+'</div>'}).join('');
  var p=A.players[0],legal=legalActions(p),call=legal.callAmount;
  var turnLabel=A.finished?'優勝！':A.handOver?(A.awards.some(function(a){return a.seat===0})?'このHandで勝利！':'このHandは終了'):A.awaiting?'あなたの番':'CPUが考えています…';
  var heroAward=A.awards.find(function(a){return a.seat===0});var winner=A.awards.length?A.awards.map(function(a){return A.players[a.seat]}).filter(Boolean)[0]:null;var heroShowdown=A.players[0].showdownScore>0;var payableCall=Math.min(call,Math.max(0,A.players[0].stack));var turnMeta=A.finished?'ゲーム終了':A.handOver?(heroAward?(heroShowdown?'勝因：'+handDetail(A.players[0].showdownScore):'他のプレイヤーがフォールド'):winner?'勝者：'+winner.name:'このHand終了'):'POT '+money(A.pot);
  var turnCard=$('turnCard');turnCard.classList.toggle('active',A.awaiting&&!A.finished&&!A.handOver);$('nextBtn').style.display=A.handOver&&!A.finished?'block':'none';
  $('turnLabel').textContent=turnLabel;$('turnMeta').textContent=turnMeta;
  $('hint').textContent=A.awaiting?(call?'必要なコール額を確認。レイズする場合は金額をスライダーで調整します。':'チェックは無料です。ベットする場合はスライダーか金額プリセットで調整します。'):(A.handOver?'結果を確認して「次のHandへ」。':A.finished?'「最初からやり直す」で再スタートできます。':'CPUが考えています…');
  $('toCall').textContent=A.awaiting?(call?'コール必要額 '+money(Math.min(call,Math.max(0,A.players[0].stack)))+(call>A.players[0].stack?'（オールイン）':''):'コール必要額 0'):' ';
  $('foldBtn').disabled=!A.awaiting||!legal.fold;
  $('callBtn').disabled=!A.awaiting||!(legal.call||legal.check);
  $('allinBtn').disabled=!A.awaiting||!legal.allin;
  $('callBtn').textContent=call?'コール '+money(Math.min(call,Math.max(0,A.players[0].stack)))+(call>A.players[0].stack?'（オールイン）':''):'チェック';
  var rangeMin=Math.min(legal.minRaise,legal.max||legal.minRaise),rangeMax=Math.max(rangeMin,legal.max),rangeStep=Math.max(10,A.blinds[0]||10);
  var startAmount=clamp(legal.minRaise,rangeMin,rangeMax),snapAmount=clamp(rangeMin+Math.round((startAmount-rangeMin)/rangeStep)*rangeStep,rangeMin,rangeMax);
  $('amountLabel').textContent=A.currentBet?'レイズ後の合計額':'ベット額';
  $('amountSlider').min=rangeMin;$('amountSlider').max=rangeMax;$('amountSlider').step=rangeStep;$('amountSlider').value=snapAmount;
  $('amount').value=$('amountSlider').value;$('amount').min=rangeMin;$('amount').max=rangeMax;
  $('amountReadout').textContent=money(Number($('amount').value));$('amountMinLabel').textContent='最小 '+money(rangeMin);$('amountMaxLabel').textContent='最大 '+money(rangeMax);$('stepLabel').textContent='刻み幅 '+money(rangeStep);
  $('amountSlider').disabled=!A.awaiting||!(legal.bet||legal.raise);
  $('betBtn').disabled=!A.awaiting||!(legal.bet||legal.raise);
  var canSize=A.awaiting&&(legal.bet||legal.raise);
  $('minusStep').disabled=!canSize||Number($('amountSlider').value)<=rangeMin;
  $('plusStep').disabled=!canSize||Number($('amountSlider').value)>=rangeMax;
  Array.prototype.forEach.call(document.querySelectorAll('.presets button'),function(btn){btn.disabled=!canSize});
  $('callBtn').classList.toggle('primary',!!(legal.call||legal.check));
  $('betBtn').classList.toggle('primary',!(legal.call||legal.check)&&(legal.bet||legal.raise));
  $('allinBtn').classList.toggle('primary',!((legal.call||legal.check)||(legal.bet||legal.raise))&&legal.allin);
  updateBetActionLabel();
  queueEquity(0);
}
function updateBetActionLabel(){var amountValue=money(Number($('amount').value)||0);$('betBtn').textContent=(A.currentBet?'レイズ ':'ベット ')+amountValue}
function setRaiseTarget(target){var slider=$('amountSlider'),min=Number(slider.min)||0,max=Number(slider.max)||min,step=Number(slider.step)||1;var next=clamp(min+Math.round((Number(target)-min)/step)*step,min,max);slider.value=next;$('amount').value=slider.value;$('amountReadout').textContent=money(Number(slider.value));$('minusStep').disabled=Number(slider.value)<=min;$('plusStep').disabled=Number(slider.value)>=max;updateBetActionLabel()}
$('amountSlider').oninput=function(){ $('amount').value=this.value;$('amountReadout').textContent=money(Number(this.value));$('minusStep').disabled=Number(this.value)<=Number(this.min);$('plusStep').disabled=Number(this.value)>=Number(this.max);updateBetActionLabel(); };
$('minusStep').onclick=function(){setRaiseTarget(Number($('amountSlider').value)-Number($('amountSlider').step))};
$('plusStep').onclick=function(){setRaiseTarget(Number($('amountSlider').value)+Number($('amountSlider').step))};
$('foldBtn').onclick=function(){human('fold')};$('callBtn').onclick=function(){var p=A.players[0],l=legalActions(p);human(l.call?'call':'check')};$('betBtn').onclick=function(){var p=A.players[0],l=legalActions(p);human(l.raise?'raise':'bet')};$('allinBtn').onclick=function(){human('allin')};$('nextBtn').onclick=nextHand;$('newBtn').onclick=function(){if(window.confirm('現在のゲームを終了して、最初からやり直しますか？\n\nこのHandの進行状況とスタックはリセットされます。'))restart()};Array.prototype.forEach.call(document.querySelectorAll('.presets button'),function(b){b.onclick=function(){var p=A.players[0],call=Math.max(0,A.currentBet-A.roundBet[0]),pot=A.pot,target;if(!p||!A.awaiting)return;if(b.dataset.size==='min')target=minRaise();else if(b.dataset.size==='half')target=A.currentBet+Math.max(A.blinds[1],Math.floor((pot+call)/2));else if(b.dataset.size==='pot')target=A.currentBet+Math.max(A.blinds[1],pot+call);else target=A.currentBet+Math.max(A.blinds[1],(pot+call)*2);setRaiseTarget(Math.min(p.stack+A.roundBet[0],target))}});
restart()
})();

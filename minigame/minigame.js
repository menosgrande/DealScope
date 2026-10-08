/* minigame.js — DealScope 4人トーナメント mini game
 * Calculatorとは分離。共有するのは engine.js の役評価のみ。
 * CPUはGTO solverではなく、TAG/LAG/TP/LPの傾向を確率パラメータ化したゲームAI。
 */
(function(){
'use strict';
var E=window.PokerEq, R=E.RANKS, S=E.SUITS;
var TYPES={
 tag:{name:'冷静なプロ',short:'TAG',vpip:0.20,raise:0.62,call:0.22,bluff:0.08,pressure:0.55,post:0.72},
 lag:{name:'攻める狂犬',short:'LAG',vpip:0.42,raise:0.70,call:0.18,bluff:0.25,pressure:0.78,post:0.82},
 tp:{name:'慎重派',short:'TP',vpip:0.14,raise:0.30,call:0.48,bluff:0.03,pressure:0.25,post:0.42},
 lp:{name:'お人よし',short:'LP',vpip:0.43,raise:0.22,call:0.64,bluff:0.12,pressure:0.35,post:0.50}
};
var NAMES=['あなた','冷静なプロ','攻める狂犬','慎重派'];
var COLORS=['#d8b252','#6f8bd8','#d17a70','#72aa8b'];
var A={players:[],deck:[],board:[],dealer:3,handNo:0,blinds:[100,200],street:'preflop',currentBet:0,lastRaise:200,actor:0,acted:[],roundBet:[],pot:0,history:[],message:'',awaiting:false,finished:false,handOver:false};
var seed=(Date.now()^Math.floor(Math.random()*4294967295))>>>0;
function rnd(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296}
function $(id){return document.getElementById(id)}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function money(n){return Math.round(n).toLocaleString('ja-JP')}
function shuffle(a){for(var i=a.length-1;i>0;i--){var j=Math.floor(rnd()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a}
function alive(){return A.players.filter(function(p){return !p.out})}
function active(){return A.players.filter(function(p){return !p.out&&!p.fold&&!p.allin})}
function contenders(){return A.players.filter(function(p){return !p.out&&!p.fold})}
function nextSeat(i){for(var k=1;k<=4;k++){var j=(i+k)%4;if(!A.players[j].out)return j}return i}
function cardName(c){return R[c>>2]+S[c&3]}
function scoreLabel(s){return ['ハイカード','ワンペア','ツーペア','スリーカード','ストレート','フラッシュ','フルハウス','フォーカード','ストレートフラッシュ'][s>>>20]||''}
function rank(c){return c>>2}
function preStrength(h){
 var a=rank(h[0]),b=rank(h[1]),hi=Math.max(a,b),lo=Math.min(a,b),pair=a===b,g=hi-lo,x;
 if(pair)x=0.55+hi*0.035; else{x=0.18+hi*0.035+lo*0.018+((h[0]&3)===(h[1]&3)?0.07:0);if(g===1)x+=0.06;if(g===2)x+=0.025;if(hi>=10&&lo>=8)x+=0.08;if(hi===12)x+=0.08}
 return clamp(x,0,1)
}
function texture(){
 var r=A.board.filter(function(c){return c>=0}),rs=r.map(rank),ss=r.map(function(c){return c&3}),u=[].concat(new Set(rs)),x=0;
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
 A.handNo++;
 if(A.handNo>1&&A.handNo%8===1){var next=[200,300,400,600,800,1200,1600,2400,3200,4800,6400],i=Math.min(Math.floor((A.handNo-1)/8),next.length-1);A.blinds=[next[i]/2,next[i]]}
 A.dealer=nextSeat(A.dealer);A.board=[];A.street='preflop';A.currentBet=0;A.lastRaise=A.blinds[1];A.pot=0;A.acted=[false,false,false,false];A.roundBet=[0,0,0,0];A.history=[];A.handOver=false;initDeck();
 A.players.forEach(function(p){p.hand=[];p.fold=false;p.allin=false;p.contrib=0;p.showdownScore=0});
 for(var k=0;k<2;k++)for(var j=0;j<4;j++){var p=A.players[(A.dealer+j)%4];if(!p.out)p.hand.push(deal())}
 var sb=nextSeat(A.dealer),bb=nextSeat(sb);
 blind(A.players[sb],A.blinds[0]);blind(A.players[bb],A.blinds[1]);A.currentBet=A.roundBet[bb];
 A.players.forEach(function(p){p.position=p.seat===A.dealer?'BTN':p.seat===sb?'SB':p.seat===bb?'BB':'UTG'});
 A.actor=nextSeat(bb);A.message='Hand #'+A.handNo+' / Blinds '+money(A.blinds[0])+'/'+money(A.blinds[1]);render();advance()
}
function roundDone(){
 var c=contenders();if(c.length<=1)return true;
 return c.filter(function(p){return !p.allin}).every(function(p){return A.acted[p.seat]&&A.roundBet[p.seat]===A.currentBet})
}
function act(seat,a,n){
 var p=A.players[seat];if(p.out||p.fold||p.allin)return false;
 var call=Math.max(0,A.currentBet-A.roundBet[seat]),text='';
 if(a==='fold'){p.fold=true;text='フォールド'}
 else if(a==='check'){if(call)return false;text='チェック'}
 else if(a==='call'){contribute(p,call);text=call?'コール':'チェック'}
 else if(a==='bet'){
   if(A.currentBet)return false;n=Math.min(p.stack,Math.max(A.blinds[1],n||A.blinds[1]));contribute(p,n);A.currentBet=A.roundBet[seat];A.lastRaise=n;A.acted=A.players.map(function(q){return q.out||q.fold||q.allin});A.acted[seat]=true;text='ベット '+money(n)
 }else if(a==='raise'){
   var min=minRaise(),target=Math.min(p.stack+A.roundBet[seat],Math.max(min,n||min)),add=target-A.roundBet[seat];
   if(add<=call)return false;var rb=target-A.currentBet;contribute(p,add);A.currentBet=target;A.lastRaise=Math.max(A.blinds[1],rb);A.acted=A.players.map(function(q){return q.out||q.fold||q.allin});A.acted[seat]=true;text='レイズ '+money(target)
 }else if(a==='allin'){
   var target2=A.roundBet[seat]+p.stack,before=A.currentBet;contribute(p,p.stack);
   if(target2>before){A.lastRaise=Math.max(A.blinds[1],target2-before);A.currentBet=target2;A.acted=A.players.map(function(q){return q.out||q.fold||q.allin});A.acted[seat]=true}
   text=target2>A.currentBet?'オールイン':'オールイン（コール）'
 }
 if(!text)return false;
 A.acted[seat]=true;A.history.push({seat:seat,text:text});A.actor=nextSeat(seat);render();return true
}
function street(){
 if(A.street==='preflop'){A.deck.pop();A.board.push(deal(),deal(),deal());A.street='flop'}
 else if(A.street==='flop'){A.deck.pop();A.board.push(deal());A.street='turn'}
 else if(A.street==='turn'){A.deck.pop();A.board.push(deal());A.street='river'}
 else{return}
 A.currentBet=0;A.lastRaise=A.blinds[1];A.roundBet=[0,0,0,0];A.acted=A.players.map(function(p){return p.out||p.fold||p.allin});A.actor=nextSeat(A.dealer);A.message=A.street==='flop'?'Flop':A.street==='turn'?'Turn':'River';render();advance()
}
function foldWin(){
 var c=contenders();if(c.length!==1)return false;var p=c[0];p.stack+=A.pot;A.message=p.name+' が '+money(A.pot)+' を獲得';A.pot=0;endHand();return true
}
function showdown(){
 var b=A.board,all=A.players.filter(function(p){return !p.out}),scores=all.map(function(p){return{p:p,s:E.evaluate(p.hand.concat(b))}});
 A.players.forEach(function(p){var z=scores.find(function(x){return x.p===p});p.showdownScore=z?z.s:0});
 var levels=[].concat(new Set(all.map(function(p){return p.contrib||0}).filter(function(x){return x>0}))).sort(function(a,b){return a-b});
 var prev=0,winners=[];
 levels.forEach(function(level){
   var participants=all.filter(function(p){return (p.contrib||0)>=level});
   var pot=(level-prev)*participants.length;
   if(pot<=0)return;
   var eligible=participants.filter(function(p){return !p.fold});
   if(!eligible.length)return;
   var best=Math.max.apply(null,eligible.map(function(p){var z=scores.find(function(x){return x.p===p});return z.s}));
   var w=eligible.filter(function(p){var z=scores.find(function(x){return x.p===p});return z.s===best});
   var base=Math.floor(pot/w.length),rem=pot%w.length;
   w.forEach(function(p,i){p.stack+=base+(i<rem?1:0)});
   winners=winners.concat(w);
   prev=level
 });
 var unique=[];winners.forEach(function(p){if(unique.indexOf(p)<0)unique.push(p)});
 A.message=unique.length===1?unique[0].name+' がポットを獲得（'+money(A.players.reduce(function(s,p){return s+(p.contrib||0)},0))+'）':'ショーダウン完了。勝者：'+unique.map(function(p){return p.name}).join(' / ');
 A.pot=0;endHand()
}
function endHand(){
 A.players.forEach(function(p){p.contrib=0;p.roundBet=0;p.allin=false;p.fold=false});A.handOver=true;render();
 setTimeout(function(){A.handOver=false;A.players.forEach(function(p){if(p.stack<=0)p.out=true});if(alive().length<=1)finish();else resetHand()},900)
}
function finish(){A.finished=true;var w=alive()[0];A.message=w?w.name+' の優勝！':'ゲーム終了';render()}
function advance(){
 if(A.finished)return;
 if(foldWin())return;
 if(roundDone()){if(A.street==='river')showdown();else street();return}
 var p=A.players[A.actor];if(!p||p.out||p.fold||p.allin){A.actor=nextSeat(A.actor);advance();return}
 if(p.seat===0){A.awaiting=true;render();return}
 A.awaiting=false;setTimeout(function(){var d=ai(p);if(!act(p.seat,d.a,d.n)){var call=Math.max(0,A.currentBet-A.roundBet[p.seat]);if(call>0)act(p.seat,'call');else act(p.seat,'check')}advance()},320)
}
function human(a){
 if(!A.awaiting||A.actor!==0||A.finished)return;
 var p=A.players[0],n=Number($('amount').value)||0;
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
 $('msg').textContent=A.message||'';$('street').textContent=A.street==='preflop'?'PREFLOP':A.street.toUpperCase();$('info').textContent='Hand #'+A.handNo+'　Blinds '+money(A.blinds[0])+'/'+money(A.blinds[1])+'　Pot '+money(A.pot);
 $('board').innerHTML=A.board.map(card).join('')||'<span class="empty">—</span>';
 $('players').innerHTML=A.players.map(function(p){
   var st=p.out?'脱落':p.fold?'Fold':p.allin?'All-in':p.seat===A.actor&&!A.handOver?'行動中':'';
   var hide=p.seat!==0&&(!A.handOver||p.fold);
   return '<section class="player '+(p.seat===0?'hero ':'')+(p.out?' out ':'')+(p.seat===A.actor&&!A.handOver?'current':'')+'"><div class="phead"><i style="background:'+COLORS[p.seat]+'"></i><b>'+p.name+'</b>'+(p.seat===A.dealer?'<span class="dealerMark">D</span>':'')+'<small>'+p.position+' '+st+'</small></div><div class="cards">'+(hide?'<span class="cardBack">◆</span><span class="cardBack">◆</span>':p.hand.map(card).join(' '))+'</div><div class="stack">'+money(p.stack)+' <small>chips</small></div><div class="betline">in pot <b>'+money(A.roundBet[p.seat]||0)+'</b></div>'+(p.showdownScore?'<div class="made">'+scoreLabel(p.showdownScore)+'</div>':'')+'</section>'
 }).join('');
 $('log').innerHTML=A.history.slice(-7).map(function(h){return '<div><b>'+A.players[h.seat].name+'</b> '+h.text+'</div>'}).join('');
 var p=A.players[0],call=p?Math.max(0,A.currentBet-A.roundBet[0]):0;
 $('hint').textContent=A.awaiting?(call?'コール '+money(call)+'。入力額はこのストリートの合計ベット額。':'チェックまたはベット。'):(A.finished?'':'CPUが考えています…');$('toCall').textContent=A.awaiting?(call?'Call '+money(call):'Check'):' ';
 $('foldBtn').disabled=!A.awaiting;$('callBtn').disabled=!A.awaiting;$('betBtn').disabled=!A.awaiting;$('allinBtn').disabled=!A.awaiting;
 $('callBtn').textContent=call?'コール '+money(call):'チェック';$('betBtn').textContent=A.currentBet?'レイズ':'ベット';
 var min=minRaise(),max=p?p.stack+A.roundBet[0]:0;$('amount').min=min;$('amount').max=Math.max(min,max);$('amount').value=clamp(min,min,Math.max(min,max))
}
$('foldBtn').onclick=function(){human('fold')};$('callBtn').onclick=function(){human('call')};$('betBtn').onclick=function(){human(A.currentBet?'raise':'bet')};$('allinBtn').onclick=function(){human('allin')};$('newBtn').onclick=restart;Array.prototype.forEach.call(document.querySelectorAll('.presets button'),function(b){b.onclick=function(){var p=A.players[0],call=Math.max(0,A.currentBet-A.roundBet[0]),pot=A.pot,target;if(!p||!A.awaiting)return;if(b.dataset.size==='min')target=minRaise();else if(b.dataset.size==='half')target=A.currentBet+Math.max(A.blinds[1],Math.floor((pot+call)/2));else if(b.dataset.size==='pot')target=A.currentBet+Math.max(A.blinds[1],pot+call);else target=A.currentBet+Math.max(A.blinds[1],(pot+call)*2);$('amount').value=Math.min(p.stack+A.roundBet[0],target)}});
restart()
})();

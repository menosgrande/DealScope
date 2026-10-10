/* minigame.js — DealScope 4人トーナメント mini game
 * Calculatorとは分離。共有するのは engine.js の役評価のみ。
 * CPUはGTO solverではなく、TAG/LAG/TP/LPの傾向を確率パラメータ化したゲームAI。
 */
(function(){
'use strict';
var E=window.PokerEq, R=E.RANKS, S=E.SUITS;
var TYPES={
 tag:{name:'冷静なプロ',short:'TAG',vpip:.20,raise:.62,call:.22,bluff:.08,pressure:.55,post:.72},
 lag:{name:'攻める狂犬',short:'LAG',vpip:.42,raise:.70,call:.18,bluff:.25,pressure:.78,post:.82},
 tp:{name:'慎重派',short:'TP',vpip:.14,raise:.30,call:.48,bluff:.03,pressure:.25,post:.42},
 lp:{name:'お人よし',short:'LP',vpip:.43,raise:.22,call:.64,bluff:.12,pressure:.35,post:.50}
};
var NAMES=['あなた','冷静なプロ','攻める狂犬','慎重派'];
var COLORS=['#d8b252','#6f8bd8','#d17a70','#72aa8b'];
var A={players:[],deck:[],board:[],dealer:3,handNo:0,blinds:[10,20],street:'preflop',currentBet:0,lastRaise:20,actor:0,acted:[],roundBet:[],pot:0,basePot:0,history:[],message:'',awaiting:false,finished:false,handOver:false,waitingNext:false};
var bridgePayload=null, bridgeImported=false, bridgeStartEquity=[], bridgeInitialPot=0, bridgeStartStacks=[]; 
try{bridgePayload=JSON.parse(sessionStorage.getItem('dealscope-analysis-game-v1')||'null')}catch(e){bridgePayload=null}
var hasBridge=!!(bridgePayload&&bridgePayload.version===1&&bridgePayload.snapshot);
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
 if(pair)x=.55+hi*.035; else{x=.18+hi*.035+lo*.018+((h[0]&3)===(h[1]&3)?.07:0);if(g===1)x+=.06;if(g===2)x+=.025;if(hi>=10&&lo>=8)x+=.08;if(hi===12)x+=.08}
 return clamp(x,0,1)
}
function texture(){
 var r=A.board.filter(function(c){return c>=0}),rs=r.map(rank),ss=r.map(function(c){return c&3}),u=[].concat(new Set(rs)),x=0;
 if(u.length<rs.length)x+=.08;
 for(var s=0;s<4;s++)if(ss.filter(function(v){return v===s}).length>=3)x+=.12;
 u.sort(function(a,b){return a-b});for(var i=0;i<u.length-1;i++)if(u[i+1]-u[i]<=2)x+=.04;
 return clamp(x,0,.35)
}
function equity(p){
 var b=A.board.filter(function(c){return c>=0});
 if(!b.length)return preStrength(p.hand);
 try{return E.monteCarloVsRandom(p.hand,b,360,{seed:((A.handNo+1)*10007+p.seat*7919+(seed>>>0))>>>0}).equity[0]/100}catch(e){return .5}
}
function minRaise(){return A.currentBet===0?A.blinds[1]:A.currentBet+Math.max(A.blinds[1],A.lastRaise||A.blinds[1])}
function amount(p,n){var max=p.stack+A.roundBet[p.seat];return Math.min(max,Math.max(0,Math.floor(n/A.blinds[1])*A.blinds[1]))}
function ai(p){
 var t=TYPES[p.type],eq=equity(p),v=clamp(eq*.72+preStrength(p.hand)*.28+(rnd()-.5)*.12,0,1),call=Math.max(0,A.currentBet-A.roundBet[p.seat]),stack=p.stack+A.roundBet[p.seat],odds=call>0?call/(A.pot+call):0,tex=texture();
 if(call>=stack)return v>=clamp(.55+t.pressure*.18-tex*.1,.45,.85)||rnd()<t.bluff*.25?{a:'allin'}:{a:'fold'};
 if(!call){
   if(A.street==='preflop'&&p.position==='BB'&&rnd()<.35&&v<.38)return{a:'check'};
   if(v<.25&&rnd()>t.bluff)return{a:'check'};
   if(rnd()<clamp(t.post*(v-.32)*1.5,0,.8))return{a:'bet',n:amount(p,Math.max(A.blinds[1],A.pot*clamp(.45+v*.55+tex*.2,.45,1.15)))};
   return{a:'check'}
 }
 if(v<odds-.08&&rnd()>t.bluff*.35)return{a:'fold'};
 if(v>.70&&rnd()<t.raise*.72){var min=minRaise(),target=clamp(A.pot*(.65+v),min,stack);return target>=stack?{a:'allin'}:{a:'raise',n:amount(p,target)}}
 if(v>.52&&rnd()<t.bluff*.18)return{a:'raise',n:amount(p,Math.max(minRaise(),A.pot*.6))};
 return rnd()<t.call||v>odds?{a:'call'}:{a:'fold'}
}
function initDeck(){A.deck=shuffle(Array.from({length:52},function(_,i){return i}))}
function nextLiveSeat(i){for(var k=1;k<=4;k++){var j=(i+k)%4;if(A.players[j]&&!A.players[j].out)return j}return i}
function deal(){return A.deck.pop()}
function blind(p,n){var x=Math.min(n,p.stack);p.stack-=x;p.contrib=x;A.roundBet[p.seat]=x;A.pot+=x;if(!p.stack)p.allin=true}
function contribute(p,n){n=Math.max(0,Math.min(n,p.stack));p.stack-=n;A.roundBet[p.seat]+=n;p.contrib=(p.contrib||0)+n;A.pot+=n;if(!p.stack)p.allin=true;return n}
function resetHand(){
 if(alive().length<=1){finish();return}
 A.handNo++;
 if(A.handNo>1&&A.handNo%4===1){A.blinds[0]*=2;A.blinds[1]*=2}
 A.dealer=nextSeat(A.dealer);A.board=[];A.street='preflop';A.currentBet=0;A.lastRaise=A.blinds[1];A.pot=0;A.acted=[false,false,false,false];A.roundBet=[0,0,0,0];A.history=[];A.handOver=false;initDeck();
 A.players.forEach(function(p){p.hand=[];p.fold=false;p.allin=false;p.contrib=0;p.showdownScore=0});
 for(var k=0;k<2;k++)for(var j=0;j<4;j++){var p=A.players[(A.dealer+j)%4];if(!p.out)p.hand.push(deal())}
 var sb=nextSeat(A.dealer),bb=nextSeat(sb);
 blind(A.players[sb],A.blinds[0]);blind(A.players[bb],A.blinds[1]);A.currentBet=A.blinds[1];
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
   text='オールイン'
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
 var c=contenders();if(c.length!==1)return false;var p=c[0];var won=A.pot;p.stack+=won;A.message=p.name+' が '+money(won)+' を獲得';A.pot=0;A.basePot=0;endHand();return true
}
function showdown(){
 var b=A.board,all=A.players.filter(function(p){return !p.out}),scores=all.map(function(p){return{p:p,s:E.evaluate(p.hand.concat(b))}});
 A.players.forEach(function(p){var z=scores.find(function(x){return x.p===p});p.showdownScore=z?z.s:0});
 var winners=[];
 // Imported start pot is a separate, shared pot: never mix it into contribution-derived side pots.
 if(A.basePot>0){var eligibleBase=all.filter(function(p){return !p.fold});if(eligibleBase.length){var bestBase=Math.max.apply(null,eligibleBase.map(function(p){return scores.find(function(x){return x.p===p}).s}));var baseWinners=eligibleBase.filter(function(p){return scores.find(function(x){return x.p===p}).s===bestBase});var baseEach=Math.floor(A.basePot/baseWinners.length),baseRem=A.basePot%baseWinners.length;baseWinners.forEach(function(p,i){p.stack+=baseEach+(i<baseRem?1:0);winners.push(p)})}A.basePot=0}
 var levels=Array.from(new Set(all.map(function(p){return p.contrib||0}).filter(function(x){return x>0}))).sort(function(a,b){return a-b});
 var prev=0;
 levels.forEach(function(level){
   var participants=all.filter(function(p){return (p.contrib||0)>=level});
   var pot=(level-prev)*participants.length;
   if(pot<=0)return;
   var eligible=participants.filter(function(p){return !p.fold});
   prev=level;
   if(!eligible.length)return;
   var best=Math.max.apply(null,eligible.map(function(p){var z=scores.find(function(x){return x.p===p});return z.s}));
   var w=eligible.filter(function(p){var z=scores.find(function(x){return x.p===p});return z.s===best});
   var base=Math.floor(pot/w.length),rem=pot%w.length;
   w.forEach(function(p,i){p.stack+=base+(i<rem?1:0)});
   winners=winners.concat(w);
 });
 var unique=[];winners.forEach(function(p){if(unique.indexOf(p)<0)unique.push(p)});
 A.message=unique.length===1?unique[0].name+' がポットを獲得（'+money(A.players.reduce(function(s,p){return s+(p.contrib||0)},0))+'）':'ショーダウン完了。勝者：'+unique.map(function(p){return p.name}).join(' / ');
 A.pot=0;A.basePot=0;endHand()
}
function endHand(){
 A.players.forEach(function(p){p.contrib=0;p.roundBet=0});A.handOver=true;A.awaiting=false;
 if(bridgeImported){A.waitingNext=true;render();return}
 A.players.forEach(function(p){p.allin=false;p.fold=false});render();
 setTimeout(function(){A.handOver=false;A.players.forEach(function(p){if(p.stack<=0)p.out=true});if(alive().length<=1)finish();else resetHand()},900)
}
function finish(){A.finished=true;var w=alive()[0];A.message=w?w.name+' の優勝！':'ゲーム終了';render()}
function advance(){
 if(A.finished)return;
 if(foldWin())return;
 if(roundDone()){if(A.street==='river')showdown();else street();return}
 var p=A.players[A.actor];if(!p||p.out||p.fold||p.allin){A.actor=nextSeat(A.actor);advance();return}
 if(p.seat===0){A.awaiting=true;render();return}
 A.awaiting=false;setTimeout(function(){var d=ai(p);if(!act(p.seat,d.a,d.n))act(p.seat,'fold');advance()},230)
}
function human(a){
 if(!A.awaiting||A.actor!==0||A.finished)return;
 var p=A.players[0],n=Number($('amount').value)||0;
 if((a==='bet'||a==='raise')&&!act(0,a,n))return;
 if(a!=='bet'&&a!=='raise'&&!act(0,a,n))return;
 A.awaiting=false;advance()
}
function restart(){
 bridgeImported=false;A.players=[];A.finished=false;A.handNo=0;A.dealer=3;A.blinds=[10,20];A.pot=0;A.basePot=0;A.waitingNext=false;
 ['tag','lag','tp','lp'].forEach(function(t,i){A.players.push({seat:i,name:NAMES[i],type:t,stack:1000,out:false,hand:[],fold:false,allin:false})});
 $('bridgeSetup').hidden=true;$('gamePanel').hidden=false;$('actionPanel').hidden=false;$('logPanel').hidden=false;
 $('nextHandBtn').hidden=true;$('returnAnalysisBtn').hidden=true;resetHand()
}
function card(c){return '<span class="card '+((c&3)===0||((c&3)===1)?'red':'')+'">'+R[c>>2]+S[c&3]+'</span>'}
function render(){
 $('msg').textContent=A.message||'';$('info').textContent='Hand #'+A.handNo+'　Blinds '+money(A.blinds[0])+'/'+money(A.blinds[1])+'　Pot '+money(A.pot)+(bridgeImported&&bridgeStartEquity.length?'　開始時の解析勝率 '+bridgeStartEquity[0].toFixed(1)+'%':'');
 $('board').innerHTML=A.board.map(card).join('')||'<span class="empty">—</span>';
 $('players').innerHTML=A.players.map(function(p){
   var st=p.out?'脱落':p.fold?'Fold':p.allin?'All-in':p.seat===A.actor&&!A.handOver?'行動中':'';
   var hide=p.seat!==0&&!A.handOver;
   return '<section class="player '+(p.seat===0?'hero ':'')+(p.out?' out':'')+'"><div class="phead"><i style="background:'+COLORS[p.seat]+'"></i><b>'+p.name+'</b><small>'+p.position+' '+st+'</small></div><div class="cards">'+(hide?'<span class="back">◆</span><span class="back">◆</span>':p.hand.map(card).join(' '))+'</div><div class="stack">'+money(p.stack)+' <small>chips</small></div>'+(p.showdownScore?'<div class="made">'+scoreLabel(p.showdownScore)+'</div>':'')+'</section>'
 }).join('');
 $('log').innerHTML=A.history.slice(-7).map(function(h){return '<div><b>'+A.players[h.seat].name+'</b> '+h.text+'</div>'}).join('');
 var p=A.players[0],call=p?Math.max(0,A.currentBet-A.roundBet[0]):0;
 $('hint').textContent=A.awaiting?(call?'コール '+money(call)+'。ベット/レイズ額はストリートの合計額。':'チェックまたはベット。'):(A.finished?'':'CPUが考えています…');
 $('foldBtn').disabled=!A.awaiting;$('callBtn').disabled=!A.awaiting;$('betBtn').disabled=!A.awaiting;$('allinBtn').disabled=!A.awaiting;
 $('nextHandBtn').hidden=!A.waitingNext;$('returnAnalysisBtn').hidden=!A.waitingNext;
 $('newBtn').hidden=bridgeImported||A.waitingNext;
 $('callBtn').textContent=call?'コール '+money(call):'チェック';$('betBtn').textContent=A.currentBet?'レイズ':'ベット';
 var min=minRaise(),max=p?p.stack+A.roundBet[0]:0;$('amount').min=min;$('amount').max=Math.max(min,max);$('amount').value=clamp(min,min,Math.max(min,max))
}
function setError(msg){$('setupError').textContent=msg;$('setupError').hidden=!msg}
function bridgeStreet(count){return count===0?'preflop':count===3?'flop':count===4?'turn':'river'}
function validBridgePayload(d){
 if(!d||d.version!==1||!d.snapshot||!['known','random'].includes(d.snapshot.mode))return false;
 var s=d.snapshot,n=s.mode==='random'?1+s.opp:s.n;
 if(!Number.isInteger(n)||n<2||n>4||d.activeCount!==n||!Array.isArray(s.players)||s.players.length!==4||!Array.isArray(s.board)||s.board.length!==5)return false;
 if(s.mode==='known'&&(!Number.isInteger(s.n)||s.n<2||s.n>4))return false;
 if(s.mode==='random'&&(!Number.isInteger(s.opp)||s.opp<1||s.opp>3))return false;
 if(s.board.some(function(c){return !Number.isInteger(c)||(c!==-1&&(c<0||c>51))}))return false;
 var bc=s.board.filter(function(c){return c>=0}).length;
 if(![0,3,4,5].includes(bc))return false;
 if(!(bc===0?s.board.every(function(c){return c===-1}):bc===3?s.board.slice(0,3).every(function(c){return c>=0})&&s.board.slice(3).every(function(c){return c===-1}):bc===4?s.board.slice(0,4).every(function(c){return c>=0})&&s.board[4]===-1:s.board.every(function(c){return c>=0})))return false;
 var shown=s.mode==='random'?1:s.n;
 for(var i=0;i<shown;i++)if(!Array.isArray(s.players[i])||s.players[i].length!==2||s.players[i].some(function(c){return !Number.isInteger(c)||c<0||c>51}))return false;
 var cards=[];s.board.forEach(function(c){if(c>=0)cards.push(c)});
 for(var i=0;i<shown;i++)s.players[i].forEach(function(c){cards.push(c)});
 var equityCount=s.mode==='random'?1:s.n;
 return new Set(cards).size===cards.length&&Array.isArray(d.equity)&&d.equity.length===equityCount&&d.equity.every(function(x){return Number.isFinite(x)&&x>=0&&x<=100});
}
function showBridgeSetup(){
 $('bridgeSetup').hidden=false;$('gamePanel').hidden=true;$('actionPanel').hidden=true;$('logPanel').hidden=true;
 $('newBtn').hidden=true;
 if(!validBridgePayload(bridgePayload)){setError('受け取った局面データが不正です。解析画面からもう一度開始してください。');$('startImported').disabled=true;return}
 var s=bridgePayload.snapshot,bc=s.board.filter(function(c){return c>=0}).length,n=bridgePayload.activeCount;
 $('setupSummary').textContent=(s.mode==='known'?'ハンド指定':'相手想定')+' / '+n+'人 / '+bridgeStreet(bc)+'開始 / 開始時の解析勝率 '+bridgePayload.equity.map(function(x,i){return (s.mode==='random'?'Hero':('P'+(i+1)))+' '+Number(x).toFixed(1)+'%'}).join('・');
 // 解析画面から実際に引き継ぐカードを開始前に明示する。相手想定の相手札は開始時に配る。
 var preview='<div class="previewGroup"><div class="previewLabel">BOARD · '+(bc===0?'未配布':bridgeStreet(bc).toUpperCase())+'</div><div class="previewCards">'+(bc?s.board.filter(function(c){return c>=0}).map(card).join(''):'<span class="previewEmpty">プリフロップから開始</span>')+'</div></div>';
 preview+='<div class="previewGroup"><div class="previewLabel">PLAYERS · '+(s.mode==='known'?'指定ハンドを引き継ぎ':'Heroのハンドを引き継ぎ')+'</div>';
 var shown=s.mode==='known'?s.n:1;
 for(var pi=0;pi<shown;pi++){
   preview+='<div class="previewPlayer"><b>'+(pi===0?'あなた':NAMES[pi])+'</b><div class="previewCards">'+s.players[pi].map(card).join('')+'</div></div>';
 }
 if(s.mode==='random')preview+='<div class="previewPlayer"><b>CPUの相手</b><span class="previewEmpty">開始時にランダム配布</span></div>';
 preview+='</div>';
 $('setupPreview').innerHTML=preview;
 $('setupPot').value=bc===0?'0':'10000';$('setupPot').disabled=bc===0;$('setupDefaultPot').textContent=bc===0?'開始ポット: 0（プリフロップは通常のブラインドから開始）':'開始ポット: 10,000（既定値）。変更する場合は詳細設定を開いてください。';
 $('stackFields').innerHTML='';
 for(var i=0;i<n;i++){var label=i===0?'あなた':NAMES[i];var row=document.createElement('label');row.className='stackField';row.innerHTML='<span>'+label+' の開始時残りスタック</span><input type="number" min="0" max="1000000000" step="1" value="1000" data-stack-seat="'+i+'">';$('stackFields').appendChild(row)}
}
function startImported(){
 setError('');
 if(!validBridgePayload(bridgePayload)){setError('局面データが不正です。解析画面からやり直してください。');return}
 var s=bridgePayload.snapshot,bc=s.board.filter(function(c){return c>=0}).length,n=bridgePayload.activeCount;
 var pot=bc===0?0:Number($('setupPot').value);
 if(!Number.isSafeInteger(pot)||pot<0||pot>1000000000){setError('開始ポットは0〜1,000,000,000の整数で入力してください。');return}
 var stacks=[],inputs=$('stackFields').querySelectorAll('input[data-stack-seat]');
 for(var i=0;i<inputs.length;i++){var v=Number(inputs[i].value);if(inputs[i].value.trim()===''||!Number.isSafeInteger(v)||v<0||v>1000000000){setError('各スタックは0〜1,000,000,000の整数で入力してください。');return}stacks.push(v)}
 if(stacks.reduce(function(a,b){return a+b},pot)>1000000000){setError('スタックと開始ポットの合計は1,000,000,000以下にしてください。');return}
 bridgeImported=true;bridgeStartEquity=bridgePayload.equity.map(Number);bridgeInitialPot=pot;bridgeStartStacks=stacks.slice();
 A.players=[];A.finished=false;A.handNo=1;A.blinds=[10,20];A.lastRaise=20;A.currentBet=0;A.pot=pot;A.basePot=pot;A.history=[];A.handOver=false;A.waitingNext=false;A.awaiting=false;
 var sCount=s.mode==='random'?1+s.opp:s.n, types=['tag','lag','tp','lp'];
 for(var i=0;i<4;i++){var participating=i<sCount;A.players.push({seat:i,name:NAMES[i],type:types[i],stack:participating?stacks[i]:0,out:!participating,hand:[],fold:false,allin:participating&&stacks[i]===0,contrib:0,showdownScore:0,position:''})}
 A.board=s.board.filter(function(c){return c>=0});
 var fixed=[];
 if(s.mode==='known'){for(var i=0;i<s.n;i++){A.players[i].hand=s.players[i].slice();fixed=fixed.concat(A.players[i].hand)}}
 else{A.players[0].hand=s.players[0].slice();fixed=fixed.concat(A.players[0].hand)}
 fixed=fixed.concat(A.board);
 A.deck=shuffle(Array.from({length:52},function(_,i){return i}).filter(function(c){return fixed.indexOf(c)<0}));
 if(s.mode==='random')for(var i=1;i<sCount;i++)A.players[i].hand=[deal(),deal()];
 A.acted=[false,false,false,false];A.roundBet=[0,0,0,0];A.street=bridgeStreet(bc);A.dealer=sCount-1;
 if(bc===0){
   A.pot=0;A.basePot=0;
   var sb,bb;
   if(sCount===2){sb=A.dealer;bb=nextSeat(sb)}else{sb=nextSeat(A.dealer);bb=nextSeat(sb)}
   A.players[sb].position=sCount===2&&sb===A.dealer?'BTN/SB':'SB';A.players[bb].position='BB';if(sCount>2)A.players[A.dealer].position='BTN';
   A.players.forEach(function(p){if(p.out)return;if(!p.position)p.position='UTG'});
   blind(A.players[sb],A.blinds[0]);blind(A.players[bb],A.blinds[1]);A.currentBet=Math.max(A.roundBet[sb],A.roundBet[bb]);A.actor=nextSeat(bb);
 }else{
   A.players.forEach(function(p){if(!p.out)p.position=sCount===2?(p.seat===A.dealer?'BTN/SB':'BB'):p.seat===A.dealer?'BTN':p.seat===nextSeat(A.dealer)?'SB':p.seat===nextSeat(nextSeat(A.dealer))?'BB':'UTG'});
   A.currentBet=0;A.lastRaise=A.blinds[1];A.actor=nextSeat(A.dealer);
 }
 A.message='解析局面から開始 / '+A.street.toUpperCase()+' / 開始ポット '+money(A.pot);
 $('bridgeSetup').hidden=true;$('gamePanel').hidden=false;$('actionPanel').hidden=false;$('logPanel').hidden=false;
 $('nextHandBtn').hidden=true;$('returnAnalysisBtn').hidden=true;$('newBtn').hidden=true;
 try{sessionStorage.removeItem('dealscope-analysis-game-v1')}catch(e){}
 render();advance()
}
function returnAnalysis(){
 if(bridgeImported&&!A.waitingNext&&!A.finished&&!confirm('進行中のハンドを終了して解析画面へ戻りますか？'))return;
 location.href='./';
}
$('foldBtn').onclick=function(){human('fold')};$('callBtn').onclick=function(){human('call')};$('betBtn').onclick=function(){human(A.currentBet?'raise':'bet')};$('allinBtn').onclick=function(){human('allin')};$('newBtn').onclick=restart;
$('startImported').onclick=startImported;$('cancelImported').onclick=function(){location.href='./'};$('nextHandBtn').onclick=function(){if(!A.waitingNext)return;A.waitingNext=false;A.handOver=false;bridgeImported=false;A.basePot=0;A.pot=0;A.players.forEach(function(p){if(p.stack<=0)p.out=true});$('nextHandBtn').hidden=true;$('returnAnalysisBtn').hidden=true;$('newBtn').hidden=false;resetHand()};
$('returnAnalysisBtn').onclick=returnAnalysis;$('backLink').addEventListener('click',function(e){e.preventDefault();returnAnalysis()});
if(hasBridge)showBridgeSetup();else restart()
})();

/* verify.js — 開発者向け検証ローダー */
(function(root){
'use strict';
const $=(id)=>document.getElementById(id),out=$('out');
const V=root.DealVerify={E:root.PokerEq,out,tests:{},tick:()=>new Promise(r=>setTimeout(r,0)),pct:v=>v.toFixed(2)+'%',pl:a=>a.map((v,i)=>'P'+(i+1)+' '+v.toFixed(2)+'%').join(' / '),num:n=>n.toLocaleString('ja-JP')};
const MARK={ok:'✓',ng:'✕',info:'・',run:'…'};
V.head=(text)=>{const d=document.createElement('div');d.className='vh';d.textContent=text;out.appendChild(d);};
V.row=(st,title,desc,detail)=>{const d=document.createElement('div');d.className='vr';d.innerHTML='<div class="st '+st+'">'+MARK[st]+'</div><div><div class="t">'+title+'</div><div class="d">'+(desc||'')+'</div>'+(detail?'<details><summary>詳細</summary><pre>'+detail+'</pre></details>':'')+'</div>';out.appendChild(d);return d;};
V.summary=()=>{const d=document.createElement('div');d.className='vsum';d.textContent='確認中…';out.appendChild(d);return d;};
V.setBusy=(b)=>{$('runAll').disabled=b;$('runBench').disabled=b;$('showCache').disabled=b;$('showObservation').disabled=b;};
V.card=s=>V.E.RANKS.indexOf(s[0].toUpperCase())*4+'shdc'.indexOf(s[1].toLowerCase());
V.cards=s=>s.trim()?s.trim().split(/\s+/).map(V.card):[];
function loadScript(src){return new Promise((resolve,reject)=>{const sc=document.createElement('script');sc.src=src;sc.onload=resolve;sc.onerror=()=>reject(new Error('読み込み失敗: '+src));document.body.appendChild(sc);});}
async function loadModules(){for(const src of ['verify/evaluator.js','verify/equity.js','verify/state.js','verify/cache.js','verify/analysis.js'])await loadScript(src);}
function showObservation(){const O=root.DealObservation,box=$('observationStats');if(!O){box.innerHTML='<div class="d">観測情報を取得できません。</div>';return;}const s=O.stats();const tags=Object.keys(s.drawTags).length?Object.entries(s.drawTags).map(([k,v])=>k+' '+v+'回').join(' / '):'なし';box.innerHTML='<div class="vsum">Analysis Layer セッション観測</div><div class="d">対象切替 '+s.analysisSelections+'回 / 表示状態変化 '+s.drawStateChanges+'回 / ドロー表示状態 '+s.drawVisibleStates+'回</div><div class="d">タグ遭遇: '+tags+'</div><div class="d">現在: '+(s.current||'表示なし')+'</div><div class="d">※ このタブ内だけの開発用カウンタ。外部送信・永続保存はしません。</div>';}
async function init(){await loadModules();
$('runAll').onclick=async()=>{V.setBusy(true);out.innerHTML='';const sum=V.summary(),results=[];V.head('① 役の判定');results.push(await V.tests.testFiveCardDistribution());results.push(await V.tests.testEvaluatorsAgree());results.push(await V.tests.testEvaluatorOrdering());results.push(await V.tests.testEquityConservation());results.push(await V.tests.testSevenCardAndEnumeration());V.head('② 勝率の計算');results.push(await V.tests.testCases());V.head('③ ランダム相手(1人モード)');results.push(await V.tests.testVsRandom());V.head('④ 最終役');results.push(await V.tests.testFinalHands());V.head('⑤ 入力状態の整理');results.push(await V.tests.testStateHelpers());results.push(await V.tests.testCanonicalState());results.push(await V.tests.testExactCacheTransparency());results.push(await V.tests.testAnalysis());const ok=results.every(Boolean);sum.className='vsum '+(ok?'ok':'ng');sum.textContent=ok?'✓ すべて合格':'✕ 不合格の項目があります';V.setBusy(false);};
$('showCache').onclick=V.showCacheStats;$('showObservation').onclick=showObservation;$('runBench').onclick=async()=>{V.setBusy(true);out.innerHTML='';try{await V.bench();}finally{V.setBusy(false);}};V.setBusy(false);}
V.setBusy(true);init().catch(err=>{out.innerHTML='<div class="vr"><div class="st ng">✕</div><div><div class="t">検証モジュールの読み込みに失敗</div><div class="d">'+String(err&&err.message||err)+'</div></div></div>';});
})(window);

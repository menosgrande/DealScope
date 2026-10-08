/* verify/analysis.js — Analysis Layer browser verification */
(function(root){
'use strict';
const V=root.DealVerify, D=root.DealDrawAnalysis, T=root.DealTextureAnalysis;
function result(ok,title,desc){V.row(ok?'ok':'ng',title,desc);return ok;}
V.tests.testAnalysis=async function(){
  V.head('⑥ Analysis Layer');
  const cases=[];
  let r=D.analyzeDraws(V.cards('5s 6s'),V.cards('7h 8d 2c'));
  cases.push(result(r.draws.some(d=>d.type==='OESD'),'OESD','5♠6♠ + 7♥8♦2♣'));
  r=D.analyzeDraws(V.cards('6s 5h'),V.cards('7d 9c 2c'));
  cases.push(result(r.draws.some(d=>d.type==='GS'),'Gutshot','6♠5♥ + 7♦9♣2♣'));
  r=D.analyzeDraws(V.cards('As Ks'),V.cards('2s 7s Qd'));
  cases.push(result(r.draws.some(d=>d.type==='FD'),'Flush Draw','A♠K♠ + 2♠7♠Q♦'));
  r=D.analyzeDraws(V.cards('Qd Jd'),V.cards('8s 9d Th Kc'));
  cases.push(result(r.draws.length===0,'Completed draw is hidden','Straight is made; no OESD badge'));
  r=D.analyzeDraws(V.cards('Ac Kd'),V.cards('5h 6c 7s'));
  cases.push(result(r.draws.length===0,'Board-only draw is hidden','Hero gets no draw from a board-only pattern'));
  r=D.analyzeDraws(V.cards('As Ks'),V.cards('2s 7s Qs 3d'));
  cases.push(result(r.draws.some(d=>d.type==='FD'),'Turn flush draw','A♠K♠ + 2♠7♠Q♠3♦'));
  r=D.analyzeDraws(V.cards('As Kd'),V.cards('2s 7s Qs 3s'));
  cases.push(result(r.draws.length===0,'Board-only flush draw is hidden','A♠K♦ + 2♠7♠Q♠3♠'));
  r=D.analyzeDraws(V.cards('5s 6h'),V.cards('7d 8c 2s 3h'));
  cases.push(result(r.draws.some(d=>d.type==='OESD'),'Turn OESD','5♠6♥ + 7♦8♣2♠3♥'));
  r=D.analyzeDraws(V.cards('As Ks'),V.cards('2s 7s Qd 3h 4c'));
  cases.push(result(r.draws.length===0,'River has no draw badge','No incomplete draw is reported on five-card board'));
  let tx=T.analyzeBoardTexture(V.cards('As Kd 7c'));
  cases.push(result(tx.tags.includes('RAINBOW') && !tx.tags.includes('MONOTONE') && !tx.tags.includes('PAIRED') && !tx.tags.includes('CONNECTED'),'Rainbow texture','A♠K♦7♣'));
  tx=T.analyzeBoardTexture(V.cards('8s 9d Tc'));
  cases.push(result(tx.tags.includes('RAINBOW') && tx.tags.includes('CONNECTED'),'Connected texture','8♠9♦T♣'));
  tx=T.analyzeBoardTexture(V.cards('As 7s 3s'));
  cases.push(result(tx.tags.includes('MONOTONE'),'Monotone texture','A♠7♠3♠'));
  tx=T.analyzeBoardTexture(V.cards('Ah Ad 7c'));
  cases.push(result(tx.tags.includes('PAIRED'),'Paired texture','A♥A♦7♣'));
  tx=T.analyzeBoardTexture(V.cards('8s 9d Tc 2h'));
  cases.push(result(tx.tags.includes('CONNECTED') && tx.tags.includes('RAINBOW'),'Turn texture tags','8♠9♦T♣2♥'));
  cases.push(result(D.analyzeDraws([],V.cards('As Kd 7c')).draws.length===0,'Invalid input is safe','Incomplete hole cards return no draw'));
  return cases.every(Boolean);
};
})(window);

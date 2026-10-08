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
  let tx=T.analyzeBoardTexture(V.cards('As Kd 7c'));
  cases.push(result(tx.tags.includes('RAINBOW') && !tx.tags.includes('CONNECTED'),'Rainbow / dry-ish board tags','A♠K♦7♣'));
  tx=T.analyzeBoardTexture(V.cards('8s 9d Tc'));
  cases.push(result(tx.tags.includes('RAINBOW') && tx.tags.includes('CONNECTED'),'Connected texture','8♠9♦T♣'));
  tx=T.analyzeBoardTexture(V.cards('Ah Ad 7c'));
  cases.push(result(tx.tags.includes('PAIRED'),'Paired texture','A♥A♦7♣'));
  return cases.every(Boolean);
};
})(window);

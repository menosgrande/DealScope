(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.DealMiniGameBetSizing=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var MULTIPLIERS={small:2.5,medium:3,large:4};
  function definitions(context){
    if(context.street==='preflop'&&context.currentBet<=context.bigBlind){
      return [
        {size:'min',label:'最小'},
        {size:'small',label:'2.5 BB'},
        {size:'medium',label:'3 BB'},
        {size:'large',label:'4 BB'}
      ];
    }
    if(context.currentBet<=0&&context.street!=='preflop'){
      return [
        {size:'min',label:'最小'},
        {size:'small',label:'1/3 POT'},
        {size:'medium',label:'1/2 POT'},
        {size:'large',label:'POT'}
      ];
    }
    return [
      {size:'min',label:'最小'},
      {size:'small',label:'2.5×'},
      {size:'medium',label:'3×'},
      {size:'large',label:'4×'}
    ];
  }
  function target(size,context){
    var min=Math.max(0,Number(context.minRaise)||0),current=Math.max(0,Number(context.currentBet)||0);
    if(size==='min')return min;
    var multiplier=MULTIPLIERS[size];
    if(!multiplier)return min;
    if(context.street==='preflop'&&current<=context.bigBlind){
      return Math.max(min,Math.round(context.bigBlind*multiplier));
    }
    if(current<=0&&context.street!=='preflop'){
      var fraction=size==='small'?1/3:size==='medium'?1/2:1;
      return Math.max(min,Math.round((Number(context.pot)||0)*fraction));
    }
    return Math.max(min,Math.round(current*multiplier));
  }
  return {definitions:definitions,target:target};
});

(function(root){'use strict';
const V=root.DealVerify;const {E,out,tick,pct,pl,num,head,row,summary,setBusy,card,cards}=V;
  /* ---------- Cache透明性 ---------- */
    async function testExactCacheTransparency() {
      const C = window.DealCache;
      C.clear();
      const cases = [
        { hands: ['As Ah', 'Kd Kc'].map(cards), board: [] },
        { hands: ['As Ks', 'Qh Qc'].map(cards), board: cards('8s 7s 2d') },
        { hands: ['As Ah', 'Kd Kc'].map(cards), board: cards('8s 7s 2d 3h') },
        { hands: ['As Ah', 'Kd Kc'].map(cards), board: cards('8s 7s 2d 3h 4c') },
      ];
      let ok = true;
      for (const x of cases) {
        const input = { players: x.hands, board: x.board, deadCards: [], calculationMode: 'exact', opponentCount: null };
        const key = S.canonicalKey(S.buildCanonicalState(input));
        if (C.get(key) !== null) ok = false;
        const expected = E.exactSync(x.hands, x.board);
        C.set(key, expected);
        if (JSON.stringify(C.get(key)) !== JSON.stringify(expected)) ok = false;
        const reordered = { players: x.hands.map((h) => h.slice().reverse()), board: x.board.slice().reverse(), deadCards: [], calculationMode: 'exact', opponentCount: null };
        const reorderedKey = S.canonicalKey(S.buildCanonicalState(reordered));
        if (reorderedKey !== key || C.get(reorderedKey) !== expected) ok = false;
      }
      const differentKey = S.canonicalKey(S.buildCanonicalState({
        players: [cards('As Ah'), cards('Kd Kh')], board: cards('8s 7s 2d'), deadCards: [], calculationMode: 'exact', opponentCount: null,
      }));
      if (C.get(differentKey) !== null) ok = false;
      const st = C.stats();
      const statsOk = st.hits === 8 && st.misses === 5 && st.size === 4 && st.hitRate === 8 / 13;
      ok = ok && statsOk;
      row(ok ? 'ok' : 'ng', 'Exact Cache透明性', 'Miss → Exact計算 → 保存 → Hit が同一結果になり、Canonical Keyの正規化も保たれる',
        ok ? `✓ 4局面 / Hit ${st.hits} / Miss ${st.misses} / Hit率 ${(st.hitRate * 100).toFixed(1)}%` : `✕ Hit ${st.hits} / Miss ${st.misses} / size ${st.size}`);
      await tick();
      return ok;
    }
    /* ---------- Exact Cache実測 ---------- */
    function showCacheStats() {
      const C = window.DealCache;
      const s = C.stats();
      const box = document.getElementById('cacheStats');
      const exactLookups = s.hits + s.misses;
      box.innerHTML =
        '<div class="vsum">Exact Cache セッション統計</div>' +
        '<div class="d">Lookup ' + exactLookups +
        ' / Hit ' + s.hits +
        ' / Miss ' + s.misses +
        ' / Hit率 ' + (s.hitRate * 100).toFixed(1) +
        '% / Entry ' + s.size + '</div>' +
        '<div class="d">※ Hit率 = Exact Cache lookup に対するHit率。Monte Carloはlookup対象外。</div>';
    }
  
    /* ---------- 計算速度 ---------- */
    async function bench() {
      const four = ['As Ks', 'Qh Qc', 'Jd Td', '9c 9d'].map(cards);
      const two = ['As Ks', 'Qh Qd'].map(cards);
      const rows = [
        ['プリフロップ 2人', two, ''],
        ['プリフロップ 4人', four, ''],
        ['フロップ 2人', two, '8s 7s 2d'],
        ['フロップ 4人', four, '8s 7s 2d'],
        ['ターン 2人', two, '8s 7s 2d 3h'],
        ['ターン 4人', four, '8s 7s 2d 3h'],
        ['リバー 2人', two, '8s 7d 9h Js Kc'],
        ['リバー 4人', four, '8s 7s 2d 3h 4c'],
      ];
      async function benchWorker(hands, board) {
        return new Promise((resolve,reject)=>{
          const w=new Worker('worker.js'); const t0=performance.now(); let settled=false;
          const finish=(fn,value)=>{if(settled)return;settled=true;w.terminate();fn(value);};
          w.onmessage=(e)=>{const m=e.data||{};if(m.type==='done')finish(resolve,{ms:performance.now()-t0,value:m.value});else if(m.type==='error')finish(reject,new Error(m.message||'Worker error'));};
          w.onerror=(e)=>finish(reject,new Error(e.message||'Worker error'));
          w.postMessage({type:'start',kind:'exact',hands,board});
        });
      }
      head('Exactの実機所要時間 (UIと同じWeb Worker経路)');
      for(const [name,hands,b] of rows){
        await tick();
        try{
          const r=await benchWorker(hands,cards(b)),ms=r.ms;
          const label=ms<1000?'快適':ms<3000?'実用的':ms<6000?'やや遅い':'遅い';
          const st=ms<3000?'ok':ms<6000?'info':'ng';
          const shown=ms<1000?Math.round(ms)+'ms':(ms/1000).toFixed(1)+'秒';
          row(st,name+': '+shown+'('+label+')',num(r.value.total)+'通り / Worker経路の実測');
        }catch(e){row('ng',name+': Worker測定失敗',String(e&&e.message||e));}
      }
      head('参考: メインスレッド直計算');
      for(const [name,hands,b] of rows.slice(0,4)){
        await tick(); const t0=performance.now(); const r=E.exactSync(hands,cards(b)); const ms=performance.now()-t0;
        const shown=ms<1000?Math.round(ms)+'ms':(ms/1000).toFixed(1)+'秒';
        row('info',name+': '+shown,num(r.total)+'通り / UIではWorkerを使用');
      }
      await tick(); const t0=performance.now(); E.monteCarlo(four,[],100000,{seed:1});
      row('info','参考: 近似計算 10万回(4人プリフロップ): '+Math.round(performance.now()-t0)+'ms','');
      const note = document.createElement('div');
      note.className = 'd'; note.style.marginTop = '10px';
      note.textContent = '目安: 1秒未満=快適 / 3秒未満=実用的 / 6秒以上=遅い(実機で遅い場合は計算の別スレッド化を検討)';
      out.appendChild(note);
      const ua = document.createElement('details');
      ua.innerHTML = `<summary class="d">測定した端末</summary><pre class="d">${navigator.userAgent}</pre>`;
      out.appendChild(ua);
    }
V.showCacheStats=showCacheStats;V.bench=bench;Object.assign(V.tests,{testExactCacheTransparency});
})(window);

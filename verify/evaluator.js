(function(root){'use strict';
const V=root.DealVerify;const {E,out,tick,pct,pl,num,head,row,summary,setBusy,card,cards}=V;
  /* ---------- 独立実装の素朴評価器 (別方式の照合用) ---------- */
    function rank5(cs) {
      const rs = cs.map((c) => c >> 2).sort((a, b) => b - a);
      const flush = cs.every((c) => (c & 3) === (cs[0] & 3));
      let sh = -1;
      if (new Set(rs).size === 5) {
        if (rs[0] - rs[4] === 4) sh = rs[0];
        else if (rs.join() === '12,3,2,1,0') sh = 3;
      }
      const cnt = {};
      rs.forEach((r) => { cnt[r] = (cnt[r] || 0) + 1; });
      const groups = Object.keys(cnt).map((r) => [cnt[r], +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
      const shape = groups.map((g) => g[0]).join('');
      let cat, tb = groups.map((g) => g[1]);
      if (sh >= 0 && flush) { cat = 8; tb = [sh]; }
      else if (shape === '41') cat = 7;
      else if (shape === '32') cat = 6;
      else if (flush) { cat = 5; tb = rs; }
      else if (sh >= 0) { cat = 4; tb = [sh]; }
      else if (shape === '311') cat = 3;
      else if (shape === '221') cat = 2;
      else if (shape === '2111') cat = 1;
      else { cat = 0; tb = rs; }
      let v = cat;
      for (let i = 0; i < 5; i++) v = v * 13 + (tb[i] || 0);
      return v;
    }
    function naiveEval(a) {
      const n = a.length;
      let best = -1;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const five = a.filter((_, k) => k !== i && k !== j);
        const v = rank5(five);
        if (v > best) best = v;
      }
      return best;
    }
  
    /* ---------- ① 役の判定 ---------- */
    async function testFiveCardDistribution() {
      const names = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ(ロイヤル含む)'];
      const expected = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
      const got = new Array(9).fill(0);
      const h = [0, 0, 0, 0, 0];
      for (let a = 0; a < 48; a++) for (let b = a + 1; b < 49; b++) {
        for (let c = b + 1; c < 50; c++) for (let d = c + 1; d < 51; d++) for (let e = d + 1; e < 52; e++) {
          h[0] = a; h[1] = b; h[2] = c; h[3] = d; h[4] = e;
          got[E.evaluate(h) >> 20]++;
        }
        if (b === 48) await tick();
      }
      const ok = got.every((v, i) => v === expected[i]);
      const detail = names.map((n, i) => `${got[i] === expected[i] ? '✓' : '✕'} ${n}: ${num(got[i])} (正解 ${num(expected[i])})`).join('\n');
      row(ok ? 'ok' : 'ng', '役の数え上げが公式の件数と一致',
        `5枚の全${num(2598960)}通りを数え、役ごとの件数を公表値と照合`, detail);
      return ok;
    }
  
    async function testEvaluatorsAgree() {
      let seed = 20240607;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const N = 30000;
      let bad = 0;
      for (let t = 0; t < N; t++) {
        const d = Array.from({ length: 52 }, (_, i) => i);
        for (let j = 0; j < 14; j++) { const k = j + Math.floor(rnd() * (52 - j)); [d[j], d[k]] = [d[k], d[j]]; }
        const A = d.slice(0, 7), B = d.slice(7, 14);
        if (Math.sign(E.evaluate(A) - E.evaluate(B)) !== Math.sign(naiveEval(A) - naiveEval(B))) bad++;
        if (t % 3000 === 0) await tick();
      }
      row(bad === 0 ? 'ok' : 'ng', '勝敗の判定が別方式の判定と一致',
        `ランダムな7枚の2ハンド ${num(N)}組で、本番の評価器と別方式の評価器の勝ち・負け・引き分けを比較` +
        (bad ? `(不一致 ${bad}件)` : '(不一致 0件)'));
      return bad === 0;
    }
  
  
    /* ---------- Evaluator の固定順位・決定論性 ---------- */
    async function testEvaluatorOrdering() {
      const goldens = [
        ['ハイカード', 'As Kd 9c 7h 2s', 0],
        ['ワンペア', 'As Ah Kd Qc Js', 1],
        ['ツーペア', 'As Ah Kd Kh Qs', 2],
        ['スリーカード', 'As Ah Ad Kd Qs', 3],
        ['A-high straight', 'As Ks Qd Jc Th', 4],
        ['フラッシュ', 'As Js 8s 4s 2s', 5],
        ['フルハウス', 'As Ah Ad Kd Kh', 6],
        ['フォーカード', 'As Ah Ad Ac Kd', 7],
        ['ストレートフラッシュ', '9s 8s 7s 6s 5s', 8],
      ];
  
      let ok = true;
      const lines = [];
      for (const [name, text, cat] of goldens) {
        const s = E.evaluate(cards(text));
        const got = s >>> 20;
        if (got !== cat) ok = false;
        lines.push(`${got === cat ? '✓' : '✕'} ${name}: category=${got} (期待 ${cat})`);
      }
  
      // Straight の rank encoding: A-high=12, K-high=11, Q-high=10, wheel=3
      const straightGoldens = [
        ['A-high', 'As Ks Qd Jc Th', 12],
        ['K-high', 'Ks Qs Jd Tc 9h', 11],
        ['Q-high', 'Qs Js Td 9c 8h', 10],
        ['wheel', 'As 2s 3d 4c 5h', 3],
      ];
      for (const [name, text, rank] of straightGoldens) {
        const s = E.evaluate(cards(text));
        const got = (s >>> 16) & 0xf;
        if ((s >>> 20) !== 4 || got !== rank) ok = false;
        lines.push(`${((s >>> 20) === 4 && got === rank) ? '✓' : '✕'} straight ${name}: high=${got} (期待 ${rank})`);
      }
  
      const compareCases = [
        ['A-high straight > K-high straight', 'As Ks Qd Jc Th', 'Ks Qs Jd Tc 9h'],
        ['K-high straight > Q-high straight', 'Ks Qs Jd Tc 9h', 'Qs Js Td 9c 8h'],
        ['wheel < 6-high straight', 'As 2s 3d 4c 5h', '6s 5d 4h 3c 2d'],
        ['AA pair: K kicker > Q kicker', 'As Ah Kd Jc 9s', 'Ac Ad Qh Jd 9c'],
        ['AAKK two pair > AAQQ two pair', 'As Ah Kd Kh Qs', 'Ac Ad Qh Qd Ks'],
        ['AAA trips: K kicker > Q kicker', 'As Ah Ad Kd Qs', 'Ac Ad Ah Qh Js'],
        ['A-high flush > K-high flush', 'As Js 8s 4s 2s', 'Ks Js 8s 4s 2s'],
        ['AAA KK full house > KKK AA full house', 'As Ah Ad Kd Kh', 'Ks Kh Kd Ac Ah'],
        ['AAAA K quads > AAAA Q quads', 'As Ah Ad Ac Kd', 'Ks Kh Kd Kc Qs'],
      ];
      for (const [name, a, b] of compareCases) {
        const passed = E.evaluate(cards(a)) > E.evaluate(cards(b));
        if (!passed) ok = false;
        lines.push(`${passed ? '✓' : '✕'} ${name}`);
      }
  
      const categoryOrder = [
        ['Straight Flush', '9s 8s 7s 6s 5s'],
        ['Quads', 'As Ah Ad Ac Kd'],
        ['Full House', 'Ks Kh Kd 2c 2d'],
        ['Flush', 'As Js 8s 4s 2s'],
        ['Straight', 'As Ks Qd Jc Th'],
        ['Trips', 'Qs Qh Qd Kc 9s'],
        ['Two Pair', 'Js Jh 8d 8c As'],
        ['Pair', 'Ts Th Kd Qc 9s'],
        ['High Card', 'As Kd 9c 7h 2s'],
      ];
      for (let i = 0; i + 1 < categoryOrder.length; i++) {
        const a = E.evaluate(cards(categoryOrder[i][1]));
        const b = E.evaluate(cards(categoryOrder[i + 1][1]));
        const passed = a > b;
        if (!passed) ok = false;
        lines.push(`${passed ? '✓' : '✕'} category monotonicity: ${categoryOrder[i][0]} > ${categoryOrder[i + 1][0]}`);
      }
  
      // 同一入力は常に同じ score を返す。cache 導入前提の決定論性チェック。
      const stableInput = cards('As Ks Qd Jc Th 2c 2d');
      const stableScore = E.evaluate(stableInput);
      let deterministic = true;
      for (let i = 0; i < 1000; i++) {
        if (E.evaluate(stableInput) !== stableScore) { deterministic = false; break; }
      }
      if (!deterministic) ok = false;
      lines.push(`${deterministic ? '✓' : '✕'} 決定論性: 同一7枚を1000回評価して同一score`);
  
      row(ok ? 'ok' : 'ng', 'Evaluator: Golden / 同カテゴリ順位 / カテゴリ単調性 / 決定論性', 
        '固定ケースで役・rank encoding・比較順序を確認し、同一入力のscoreが常に一定であることを確認', lines.join('\\n'));
      await tick();
      return ok;
    }
  
    /* ---------- 7枚評価 / 列挙の固定検証 ---------- */
    async function testSevenCardAndEnumeration() {
      const cases = [
        ['A-high straight', 'As Ks Qd Jc Th 2c 7d'],
        ['quads', 'As Ah Ad Ac Kd 2c 7h'],
        ['full house', 'As Ah Ad Kd Kh 2c 7s'],
        ['flush', 'As Js 8s 4s 2s Kd Qc'],
        ['two pair', 'As Ah Kd Kh Qs 2c 7d'],
        ['pair', 'As Ah Kd Qc Js 2d 7h'],
      ];
      let ok = true;
      const lines = [];
      for (const [name, text] of cases) {
        const cs = cards(text);
        const direct = E.evaluate(cs);
        const best = E.bestFive(cs);
        const passed = direct === best.score;
        if (!passed) ok = false;
        lines.push(`${passed ? '✓' : '✕'} 7枚 ${name}: evaluate === bestFive.score`);
      }
  
      // 2〜4人の既知ハンドでは、残りデックからriverまでの組合せ数を固定する。
      const counts = [
        ['2人 preflop', ['As Ks', 'Qh Qd'], 1712304],
        ['3人 preflop', ['As Ks', 'Qh Qd', 'Jc Td'], 1370754],
        ['4人 preflop', ['As Ks', 'Qh Qd', 'Jc Td', '9c 9d'], 1086008],
        ['2人 flop', ['As Ks', 'Qh Qd'], '2c 7d 9h', 990],
        ['2人 turn', ['As Ks', 'Qh Qd'], '2c 7d 9h Js', 44],
        ['2人 river', ['As Ks', 'Qh Qd'], '2c 7d 9h Js Kc', 1],
      ];
      for (const item of counts) {
        const [name, handText, boardTextOrExpected, expectedMaybe] = item;
        const boardText = typeof boardTextOrExpected === 'string' ? boardTextOrExpected : '';
        const expected = expectedMaybe === undefined ? boardTextOrExpected : expectedMaybe;
        const r = E.exactSync(handText.map(cards), cards(boardText));
        const passed = r.total === expected;
        if (!passed) ok = false;
        lines.push(`${passed ? '✓' : '✕'} enumeration ${name}: ${r.total} (期待 ${expected})`);
      }
  
      row(ok ? 'ok' : 'ng', '7枚評価 / Enumeration: 固定ケースと組合せ数',
        '7枚の直接評価と最強5枚評価のscore一致、およびExactの列挙総数を固定値で確認', lines.join('\\n'));
      await tick();
      return ok;
    }
    /* ---------- Equity 保存則 ---------- */
    async function testEquityConservation() {
      const cases = [
        ['2人 リバー', ['Ks Kd', 'Ah Ad'], '2c 7d 9h Js Kc'],
        ['3人 リバー', ['2d 3d', '4d 5d', '6d 7d'], 'As Ks Qs Js Ts'],
        ['4人 リバー', ['As Kd', 'Qh Qc', 'Jd Td', '9c 9d'], '8s 7s 2d 3h 4c'],
        ['2人 ターン', ['Ah Ad', '9s 9d'], '2c 5d 9h Js'],
      ];
      let ok = true;
      const lines = [];
      for (const [name, handText, boardText] of cases) {
        const r = E.exactSync(handText.map(cards), cards(boardText));
        const sum = r.equity.reduce((a, b) => a + b, 0);
        const passed = Math.abs(sum - 100) < 1e-9;
        if (!passed) ok = false;
        lines.push(`${passed ? '✓' : '✕'} ${name}: equity合計=${sum.toFixed(12)}%`);
      }
      row(ok ? 'ok' : 'ng', 'Equity保存則: 全プレイヤーのequity合計 = 100%', 
        'Exactの複数人数・複数streetでポット分配の総量が保存されることを確認', lines.join('\\n'));
      await tick();
      return ok;
    }
V.naiveEval=naiveEval;Object.assign(V.tests,{testFiveCardDistribution,testEvaluatorsAgree,testEvaluatorOrdering,testSevenCardAndEnumeration,testEquityConservation});
})(window);

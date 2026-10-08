(function(root){'use strict';
const V=root.DealVerify;const {E,out,tick,pct,pl,num,head,row,summary,setBusy,card,cards}=V;
  /* ---------- ② 勝率の計算 ---------- */
    const CASES = [
      { note: 'リバー: セット vs オーバーペア', hands: ['Ks Kd', 'Ah Ad'], board: '2c 7d 9h Js Kc', expected: [100, 0], src: 'ルールから確定(リバーは結果が決まっている)' },
      { note: 'リバー: ボードのロイヤルで3人チョップ', hands: ['2d 3d', '4d 5d', '6d 7d'], board: 'As Ks Qs Js Ts', expected: [100 / 3, 100 / 3, 100 / 3], src: 'ルールから確定(全員ボードで同じ役)' },
      { note: 'リバー: ボードのブロードウェイで2人チョップ', hands: ['2s 3s', '4s 5s'], board: 'Ah Kd Qc Jd Th', expected: [50, 50], src: 'ルールから確定(全員ボードで同じ役)' },
      { note: 'ターン: Aが出れば逆転(アウト2枚/44枚)', hands: ['Ah Ad', '9s 9d'], board: '2c 5d 9h Js', expected: [200 / 44, 4200 / 44], src: '手計算: P1が勝つのはリバーがAs・Acの2/44だけ' },
      { note: 'プリフロップ 2人(AKs vs QQ)', hands: ['As Ks', 'Qh Qd'], board: '', expected: null, src: '' },
      { note: 'フロップ 3人(AKs / QQ / JTs)', hands: ['As Ks', 'Qh Qc', 'Js Ts'], board: '8s 7s 2d', expected: null, src: '' },
    ];
    const TRIALS = [10000, 50000, 100000];
  
    async function testCases() {
      let allOk = true;
      for (const cs of CASES) {
        const hands = cs.hands.map(cards), board = cards(cs.board);
        const ex = E.exactSync(hands, board);
        let st = cs.expected ? 'ok' : 'info';
        const lines = [];
        let desc;
  
        if (cs.expected) {
          if (!cs.expected.every((v, i) => Math.abs(v - ex.equity[i]) < 1e-6)) st = 'ng';
          desc = `正解 ${pl(cs.expected)}<br>計算 ${pl(ex.equity)}<br>根拠: ${cs.src}`;
        } else {
          desc = `計算 ${pl(ex.equity)}<br>正解値は未登録のため、近似計算との比較のみ`;
        }
        lines.push(`厳密計算(Exact): ${num(ex.total)}通りを全て列挙`);
  
        if (board.length >= 3) {
          const nv = E.exactSync(hands, board, { evalFn: naiveEval });
          const same = nv.equity.every((v, i) => Math.abs(v - ex.equity[i]) < 1e-9);
          if (!same) st = 'ng';
          lines.push(`別方式の評価器で再計算: ${same ? '一致' : '不一致'}`);
        }
        await tick();
  
        let mcOk = true;
        for (const n of TRIALS) {
          const mc = E.monteCarlo(hands, board, n, { seed: 12345 });
          let maxDiff = 0, maxZ = 0;
          mc.equity.forEach((v, i) => {
            const p = ex.equity[i] / 100;
            const se = Math.max(Math.sqrt(p * (1 - p) / n) * 100, 0.05);
            maxDiff = Math.max(maxDiff, Math.abs(v - ex.equity[i]));
            maxZ = Math.max(maxZ, Math.abs(v - ex.equity[i]) / se);
          });
          if (maxZ > 4) mcOk = false;
          lines.push(`近似計算(Monte Carlo) ${num(n)}回: 厳密との差 最大${maxDiff.toFixed(2)}pt`);
          await tick();
        }
        if (!mcOk) st = 'ng';
        lines.push(mcOk ? '近似計算は誤差の許容範囲内' : '近似計算が許容範囲外');
        if (st === 'ng') allOk = false;
        row(st, cs.note, desc, lines.join('\n'));
      }
      return allOk;
    }
  
    /* ---------- ③ ランダム相手(1人モード) ---------- */
    // 別方式の確認用: 本番の列挙コードを使わず、素朴評価器で相手の全組み合わせを数える(ターン/リバー用)
    function bruteVsRandom(hero, board) {
      const dead = new Set([...hero, ...board]);
      const deck = [];
      for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
      const need = 5 - board.length;
      let w = 0, t = 0, tot = 0;
      for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) {
        const runs = need === 0 ? [null] : deck.filter((c) => c !== deck[i] && c !== deck[j]);
        for (const r of runs) {
          const bd = need === 0 ? board : board.concat([r]);
          const h = naiveEval(hero.concat(bd)), o = naiveEval([deck[i], deck[j]].concat(bd));
          tot++;
          if (h > o) w++; else if (h === o) t++;
        }
      }
      return ((w + t / 2) / tot) * 100;
    }
  
    // 相手2人・リバー確定: 相手2人の手の全組み合わせを、本番とは別の素朴なループで数える
    function exactTwoRandomRiver(hero, board) {
      const dead = new Set([...hero, ...board]);
      const deck = [];
      for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c);
      const hv = E.evaluate(hero.concat(board));
      let sum = 0, tot = 0;
      for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) {
        const s1 = E.evaluate([deck[i], deck[j]].concat(board));
        for (let k = 0; k < deck.length; k++) {
          if (k === i || k === j) continue;
          for (let l = k + 1; l < deck.length; l++) {
            if (l === i || l === j) continue;
            const s2 = E.evaluate([deck[k], deck[l]].concat(board));
            tot++;
            const best = s1 > s2 ? s1 : s2;
            if (hv > best) sum += 1;
            else if (hv === best) sum += 1 / (1 + (s1 === hv ? 1 : 0) + (s2 === hv ? 1 : 0));
          }
        }
      }
      return (sum / tot) * 100;
    }
  
    async function testVsRandom() {
      let allOk = true;
      for (const [note, hs, bs] of [
        ['リバー: Hero KK + ボード K72 9 J', 'Ks Kd', '2c 7d 9h Js Kc'],
        ['ターン: Hero AA + ボード 2 5 9 J', 'Ah Ad', '2c 5d 9h Js'],
      ]) {
        const hero = cards(hs), board = cards(bs);
        const g = E.exactVsRandomGen(hero, board);
        let r; while (!(r = g.next()).done) { /* 完了まで */ }
        const ref = bruteVsRandom(hero, board);
        const ok = Math.abs(r.value.equity[0] - ref) < 1e-9;
        if (!ok) allOk = false;
        row(ok ? 'ok' : 'ng', `ランダム相手 ${note}`,
          `勝率 ${pct(r.value.equity[0])}(${num(r.value.total)}通り)<br>別方式(素朴評価器で全組み合わせを数え直し) ${pct(ref)}`);
        await tick();
      }
      // Flop: 厳密値 vs Monte Carlo(Preflopと同じ関数)
      const hero = cards('As Ks'), board = cards('8s 7s 2d');
      const g = E.exactVsRandomGen(hero, board);
      let r; while (!(r = g.next()).done) { /* 完了まで */ }
      const ex = r.value.equity[0];
      const lines = []; let mcOk = true;
      for (const n of TRIALS) {
        const mc = E.monteCarloVsRandom(hero, board, n, { seed: 12345 }).equity[0];
        const p = ex / 100;
        const se = Math.max(Math.sqrt(p * (1 - p) / n) * 100, 0.05);
        if (Math.abs(mc - ex) > 4 * se) mcOk = false;
        lines.push(`近似計算(Monte Carlo) ${num(n)}回: ${pct(mc)} / 厳密との差 ${Math.abs(mc - ex).toFixed(2)}pt`);
        await tick();
      }
      if (!mcOk) allOk = false;
      row(mcOk ? 'ok' : 'ng', 'ランダム相手 フロップ: 厳密値と近似計算が一致',
        `厳密 ${pct(ex)}(${num(r.value.total)}通り)。Preflopと同じ近似計算を、厳密値のあるフロップで確認`, lines.join('\n'));
      // 相手2人(リバー): 近似計算を、全組み合わせの数え上げと比較
      {
        const h2 = cards('Ks Kd'), b2 = cards('2c 7d 9h Js Kc');
        const ex2 = exactTwoRandomRiver(h2, b2);
        const mc2 = E.monteCarloVsRandom(h2, b2, 100000, { seed: 12345, opponents: 2 }).equity[0];
        const p2 = ex2 / 100;
        const se2 = Math.max(Math.sqrt(p2 * (1 - p2) / 100000) * 100, 0.05);
        const ok2 = Math.abs(mc2 - ex2) <= 4 * se2;
        if (!ok2) allOk = false;
        row(ok2 ? 'ok' : 'ng', 'ランダム相手2人 リバー: 近似計算と全組み合わせの一致',
          `全組み合わせ ${pct(ex2)} / 近似計算(10万回) ${pct(mc2)} / 差 ${Math.abs(mc2 - ex2).toFixed(2)}pt`);
        await tick();
      }
      // Preflop: 正解値は外部の計算機の値待ち
      const pre = E.monteCarloVsRandom(cards('As Ks'), [], 100000, { seed: 12345 }).equity[0];
      row('info', 'ランダム相手 プリフロップ(AKs)', `近似計算 ${pct(pre)}。正解値は未登録(外部の計算機の値を、サイト名・取得日・引き分けの扱いと一緒に登録する)`);
      return allOk;
    }
  
  
    /* ---------- ④ 最終役 ---------- */
    const CATNAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];
    const catOf = (v) => Math.floor(v / Math.pow(13, 5)); // naiveEval の値 → 役のカテゴリ
    const catLine = (c) => c.map((v, k) => (v > 0 ? `${CATNAMES[k]} ${v.toFixed(2)}%` : null)).filter(Boolean).join(' / ');
    // MC と Exact の割合の差を、勝率の検証と同じ式(4σ)で判定
    function catsClose(mc, ex, n) {
      let maxZ = 0, maxDiff = 0;
      for (let k = 0; k < 9; k++) {
        const p = ex[k] / 100;
        const se = Math.max(Math.sqrt(p * (1 - p) / n) * 100, 0.05);
        maxZ = Math.max(maxZ, Math.abs(mc[k] - ex[k]) / se);
        maxDiff = Math.max(maxDiff, Math.abs(mc[k] - ex[k]));
      }
      return { ok: maxZ <= 4, maxDiff };
    }
  
    async function testFinalHands() {
      let allOk = true;
  
      // (a) リバー確定: 最終役は決まっている。別方式の評価器の判定と照合
      for (const cs of CASES.filter((c) => cards(c.board).length === 5)) {
        const hands = cs.hands.map(cards), board = cards(cs.board);
        const ex = E.exactSync(hands, board);
        const want = hands.map((h) => catOf(naiveEval(h.concat(board))));
        const catOk = ex.cats.every((c, p) => c.every((v, k) => Math.abs(v - (k === want[p] ? 100 : 0)) < 1e-9));
        const eqSumOk = ex.catEquity.every((c, p) => Math.abs(c.reduce((a, b) => a + b, 0) - ex.equity[p]) < 1e-9);
        const eqRoleOk = ex.catEquity.every((c, p) => c.every((v, k) => Math.abs(v - (k === want[p] ? ex.equity[p] : 0)) < 1e-9));
        const ok = catOk && eqSumOk && eqRoleOk;
        if (!ok) allOk = false;
        row(ok ? 'ok' : 'ng', `最終役 ${cs.note}`,
          ex.cats.map((c, p) => `P${p + 1}: ${catLine(c)}(別方式の判定: ${CATNAMES[want[p]]}) / 寄与合計 ${pct(ex.catEquity[p].reduce((a, b) => a + b, 0))} = 勝率 ${pct(ex.equity[p])}`).join('<br>'));
      }
      await tick();
  
      // (b) フロップ3人: 各人の合計が100% / Exact と Monte Carlo(別コードパス)が一致
      {
        const hands = ['As Ks', 'Qh Qc', 'Js Ts'].map(cards), board = cards('8s 7s 2d');
        const ex = E.exactSync(hands, board);
        const sumOk = ex.cats.every((c) => Math.abs(c.reduce((a, b) => a + b, 0) - 100) < 1e-9);
        const eqSumOk = ex.catEquity.every((c, p) => Math.abs(c.reduce((a, b) => a + b, 0) - ex.equity[p]) < 1e-9);
        const N = 100000;
        const mc = E.monteCarlo(hands, board, N, { seed: 12345 });
        const cmp = mc.cats.map((c, p) => catsClose(c, ex.cats[p], N));
        const cmpEq = mc.catEquity.map((c, p) => catsClose(c, ex.catEquity[p], N));
        const eqMcSumOk = mc.catEquity.every((c, p) => Math.abs(c.reduce((a, b) => a + b, 0) - mc.equity[p]) < 1e-9);
        const ok = sumOk && eqSumOk && eqMcSumOk && cmp.every((r) => r.ok) && cmpEq.every((r) => r.ok);
        if (!ok) allOk = false;
        row(ok ? 'ok' : 'ng', '最終役 フロップ3人: 成立率100%、勝率寄与は勝率に一致、Exact と Monte Carlo が一致',
          `成立率合計 ${sumOk ? '100%' : '不一致'} / 寄与合計＝勝率 ${eqSumOk && eqMcSumOk ? 'OK' : '不一致'} / 成立率差 最大 ${Math.max(...cmp.map((r) => r.maxDiff)).toFixed(2)}pt / 寄与差 最大 ${Math.max(...cmpEq.map((r) => r.maxDiff)).toFixed(2)}pt`,
          ex.cats.map((c, p) => `P${p + 1}: ${catLine(c)} / 寄与合計 ${pct(ex.catEquity[p].reduce((a, b) => a + b, 0))}`).join('\n'));
        await tick();
      }
  
      // (c) ランダム相手: Hero は、相手の人数が変わっても同じ分布(Exact = 相手1人 と MC 相手2人 を比較)
      {
        const hero = cards('As Ks'), board = cards('8s 7s 2d');
        const g = E.exactVsRandomGen(hero, board);
        let r; while (!(r = g.next()).done) { /* 完了まで */ }
        const ex = r.value.cats; // [Hero, 相手] 成立率
        const gEq = E.exactVsRandomGen(hero, board);
        let re; while (!(re = gEq.next()).done) { /* 完了まで */ }
        const exEq = re.value.catEquity; // [Hero, 相手]
        const sumOk = ex.every((c) => Math.abs(c.reduce((a, b) => a + b, 0) - 100) < 1e-9);
        const eqSumOk = exEq.every((c, p) => Math.abs(c.reduce((a, b) => a + b, 0) - (p === 0 ? re.value.equity[0] : 100 - re.value.equity[0])) < 1e-9);
        const N = 100000;
        const lines = []; let ok = sumOk && eqSumOk;
        for (const opps of [1, 2]) {
          const mc = E.monteCarloVsRandom(hero, board, N, { seed: 12345, opponents: opps });
          const h = catsClose(mc.cats[0], ex[0], N), o = catsClose(mc.cats[1], ex[1], N * opps);
          const hEqSum = Math.abs(mc.catEquity[0].reduce((a, b) => a + b, 0) - mc.equity[0]) < 1e-9;
          const oEqSum = Math.abs(mc.catEquity[1].reduce((a, b) => a + b, 0) - (100 - mc.equity[0]) / opps) < 1e-9;
          let eqDetail = `寄与合計 Hero=${pct(mc.catEquity[0].reduce((a, b) => a + b, 0))} / 相手1人=${pct(mc.catEquity[1].reduce((a, b) => a + b, 0))}`;
          if (opps === 1) {
            const he = catsClose(mc.catEquity[0], exEq[0], N), oe = catsClose(mc.catEquity[1], exEq[1], N);
            if (!he.ok || !oe.ok) ok = false;
            eqDetail += ` / 寄与差 Hero=${he.maxDiff.toFixed(2)}pt 相手=${oe.maxDiff.toFixed(2)}pt`;
          }
          if (!h.ok || !o.ok || !hEqSum || !oEqSum) ok = false;
          lines.push(`相手${opps}人: 成立率差 Hero=${h.maxDiff.toFixed(2)}pt / 相手1人=${o.maxDiff.toFixed(2)}pt / ${eqDetail}`);
          await tick();
        }
        if (!ok) allOk = false;
        row(ok ? 'ok' : 'ng', '最終役 ランダム相手: 成立率と勝率寄与の整合',
          '成立率は相手人数が変わっても相手1人あたりで同じ。勝率寄与は相手人数に応じて変わるため、各人数で合計値を確認し、相手1人ではExactとも比較',
          lines.join('\n') + `\nHero成立率: ${catLine(ex[0])}\n相手成立率: ${catLine(ex[1])}`);
      }
      return allOk;
    }
Object.assign(V.tests,{testCases,testVsRandom,testFinalHands});
})(window);

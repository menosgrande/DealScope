/* verify.js — 検証専用 (index.html の「検証」パネルを開いたときだけ読み込まれる)
 *
 * 「計算が正しいか確認」
 *   ① 役の判定: 5枚役の全分布を、公表されている件数と照合 / 別方式の評価器と勝敗を照合
 *   ② 勝率の計算: 既知ケースで 正解値 ・ Exact ・ Monte Carlo を比較
 *   ③ ランダム相手
 *   ④ 最終役: 成立率と勝率の内訳を、別方式の評価器・Monte Carlo と照合
 *   ⑤ 入力状態の整理: 重複カードの整理・URLの往復・保存データの読み込み (state.js)
 * 「計算速度を測る」
 *   この端末での Exact の所要時間
 *
 * expected が null のケースは「外部の信頼できる計算機の値を入れる枠」。推測値は入れない。
 */
(function () {
  'use strict';
  const E = PokerEq;
  const out = document.getElementById('out');
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const pct = (v) => v.toFixed(2) + '%';
  const pl = (a) => a.map((v, i) => `P${i + 1} ${pct(v)}`).join(' / ');
  const num = (n) => n.toLocaleString('ja-JP');

  const card = (s) => E.RANKS.indexOf(s[0].toUpperCase()) * 4 + 'shdc'.indexOf(s[1].toLowerCase());
  const cards = (s) => (s.trim() ? s.trim().split(/\s+/).map(card) : []);

  /* ---------- 表示 ---------- */
  const MARK = { ok: '✓', ng: '✕', info: '・', run: '…' };
  function head(text) {
    const d = document.createElement('div'); d.className = 'vh'; d.textContent = text; out.appendChild(d);
  }
  function row(st, title, desc, detail) {
    const d = document.createElement('div');
    d.className = 'vr';
    d.innerHTML = `<div class="st ${st}">${MARK[st]}</div><div><div class="t">${title}</div>` +
      `<div class="d">${desc || ''}</div>` +
      (detail ? `<details><summary>詳細</summary><pre>${detail}</pre></details>` : '') + '</div>';
    out.appendChild(d);
    return d;
  }
  function summary() {
    const d = document.createElement('div'); d.className = 'vsum'; d.textContent = '確認中…'; out.appendChild(d); return d;
  }
  function setBusy(b) {
    document.getElementById('runAll').disabled = b;
    document.getElementById('runBench').disabled = b;
  }

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

  /* ---------- ⑤ 入力状態の整理 (state.js) ---------- */
  async function testStateHelpers() {
    const S = window.DealState;
    let allOk = true;
    const check = (name, ok, detail) => { if (!ok) allOk = false; row(ok ? 'ok' : 'ng', name, '', detail); };
    const H = (a, b) => [card(a), card(b)];
    const blank = () => [[-1, -1], [-1, -1], [-1, -1], [-1, -1]];
    const json = JSON.stringify;

    // dedupe: Board と P1 を守り、後ろ(P2→P3→P4)の重複だけ空欄にする
    {
      const board = cards('Ah 7d 2c').concat([-1, -1]);
      const players = blank();
      players[0] = H('As', 'Kd');
      players[1] = H('Ah', 'Qs');   // Ah は Board と重複 → P2 側が空欄
      players[2] = H('Kd', 'Jc');   // Kd は P1 と重複 → P3 側が空欄
      players[3] = H('Qs', 'Jc');   // Qs は P2(残った Qs) と重複、Jc は P3 の Jc と重複
      const r = S.dedupe(board, players);
      const want = [H('As', 'Kd'), [-1, card('Qs')], [-1, card('Jc')], [-1, -1]];
      const ok = json(r.players) === json(want) && json(r.board) === json(board) &&
        players[1][0] === card('Ah'); // 入力の配列そのものは変更しない
      check('重複の整理: Board と Hero(P1) を優先し、P2→P3→P4 の重複だけ空欄にする', ok, json(r.players));
    }
    // dedupe: 重複が無ければそのまま
    {
      const players = blank(); players[0] = H('As', 'Kd'); players[1] = H('Qh', 'Qs');
      const r = S.dedupe(cards('2c 3c 4c').concat([-1, -1]), players);
      check('重複の整理: 重複が無ければ変わらない', json(r.players) === json(players), '');
    }
    // encode → decode の往復
    {
      const mk = (mode, n, opp, p, b) => ({ mode, n, opp, players: p, board: b });
      const p3 = blank(); p3[0] = H('Ad', 'Ts'); p3[1] = H('2c', '7h'); p3[2] = H('Kd', 'Ks');
      const pr = blank(); pr[0] = H('Ad', 'Ts');
      const full = cards('Kh 7d 3s Qc 2h');
      const cases = [
        mk('known', 2, 1, blank(), [-1, -1, -1, -1, -1]),
        mk('known', 3, 1, p3, [-1, -1, -1, -1, -1]),
        mk('known', 3, 1, p3, full),
        mk('known', 4, 1, blank(), cards('Kh 7d 3s').concat([-1, -1])),
        mk('random', 2, 1, pr, [-1, -1, -1, -1, -1]),
        mk('random', 2, 3, pr, cards('Kh 7d 3s Qc').concat([-1])),
        mk('random', 2, 4, blank(), full),
      ];
      let bad = [];
      cases.forEach((c, i) => {
        const h = S.encode(c);
        const d = h === '' ? { mode: 'known', n: 2, opp: 1, players: blank(), board: [-1, -1, -1, -1, -1] } : S.decode(h);
        if (!d || d.mode !== c.mode || (c.mode === 'known' && d.n !== c.n) || (c.mode === 'random' && d.opp !== c.opp) ||
            json(d.board) !== json(c.board) || json(d.players.slice(0, c.mode === 'random' ? 1 : c.n)) !== json(c.players.slice(0, c.mode === 'random' ? 1 : c.n))) {
          bad.push(`#${i} ${h}`);
        }
      });
      check('URL: 書き出して読み戻すと同じ状態になる', bad.length === 0, bad.length ? '不一致: ' + bad.join(', ') : `${cases.length}パターン一致`);
    }
    // URL にはランダム相手のとき P2 以降を入れない
    {
      const p = blank(); p[0] = H('As', 'Kd'); p[1] = H('Qh', 'Qs');
      const h = S.encode({ mode: 'random', n: 2, opp: 2, players: p, board: [-1, -1, -1, -1, -1] });
      check('URL: ランダム相手では、隠れているP2以降を含めない', h === '#AsKd-??-??', h);
    }
    // 不正なURLは null
    {
      const bads = ['#AdTs-??-2c7h', '#AdTs-2c7h-KdKs-QdQs-JdJs', '#AdTs-2c7', '#AdTs-2c7h/Kh7d/Qc/2h/xx', '#??-??', '#AdTs-??-??-??-??-??'];
      const leaked = bads.filter((b) => S.decode(b) !== null);
      check('URL: 不正な形式は読み込まない', leaked.length === 0, leaked.length ? '読み込めてしまった: ' + leaked.join(', ') : `${bads.length}パターン拒否`);
    }
    // 保存データ: 旧形式 (n === 1 = ランダム相手) / 新形式 / 壊れたデータ
    {
      const p = blank(); p[0] = H('As', 'Kd'); p[1] = H('Qh', 'Qs'); p[2] = H('2c', '3c');
      const b = [-1, -1, -1, -1, -1];
      const legacy = S.normalizeSaved({ n: 1, opp: 3, players: p, board: b });
      const modern = S.normalizeSaved({ mode: 'random', n: 3, opp: 2, players: p, board: b });
      const dup = S.normalizeSaved({ mode: 'known', n: 2, opp: 1, players: [H('As', 'Kd'), H('As', 'Qs'), [-1, -1], [-1, -1]], board: b });
      const ok = legacy && legacy.mode === 'random' && legacy.opp === 3 && legacy.n === 2 &&
        modern && modern.mode === 'random' && modern.n === 3 && json(modern.players[1]) === json(p[1]) && json(modern.players[3]) === json([-1, -1]) &&
        dup && json(dup.players[1]) === json([-1, card('Qs')]) &&
        S.normalizeSaved(null) === null && S.normalizeSaved({ n: 9, players: p, board: b }) === null &&
        S.normalizeSaved({ mode: 'known', n: 2, players: [[1, 2]], board: b }) === null;
      check('保存データ: 旧形式を読める / 隠れたP2〜も保持 / 重複は整理 / 壊れたデータは無視', !!ok, '');
    }
    // ストリート単位のボード引き直し: 対象ストリートだけを変更し、後続ストリートを保持する
    {
      let seed = 24681357;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const p = blank(); p[0] = H('As', 'Kd'); p[1] = H('Qh', 'Qs');
      const b = cards('2c 3c 4c 5c 6c');
      const rf = S.shuffleBoardStreet(p, b, 0, rnd);
      const rt = S.shuffleBoardStreet(p, b, 1, rnd);
      const rr = S.shuffleBoardStreet(p, b, 2, rnd);
      const basePlayers = json(rf.players) === json(p) && json(rt.players) === json(p) && json(rr.players) === json(p);
      const flopOnly = rf.board.slice(3).every((c, i) => c === b[i + 3]) && new Set(rf.board.slice(0, 3)).size === 3;
      const turnOnly = rt.board[0] === b[0] && rt.board[1] === b[1] && rt.board[2] === b[2] && rt.board[4] === b[4] && rt.board[3] !== b[3];
      const riverOnly = rt.board[0] === b[0] && rr.board[0] === b[0] && rr.board[1] === b[1] && rr.board[2] === b[2] && rr.board[3] === b[3] && rr.board[4] !== b[4];
      const noOverlap = [rf.board, rt.board, rr.board].every((x) => x.every((card) => !p.flat().includes(card)));
      const inputKeep = json(b) === json(cards('2c 3c 4c 5c 6c'));
      check('ストリート引き直し: Flop/Turn/Riverの対象部分だけ変更し、後ろを保持する', basePlayers && flopOnly && turnOnly && riverOnly && noOverlap && inputKeep, '');
    }
    // Hand引き直し / 消去: 対象だけを変更し、Boardと他プレイヤーを保持する
    {
      let seed = 97531;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const p = blank(); p[0] = H('As', 'Kd'); p[1] = H('Qh', 'Qs'); p[2] = H('2c', '3c'); p[3] = H('9h', '9d');
      const b = cards('4c 5c 6c 7c 8c');
      const one = S.shufflePlayerHand(p, b, 1, rnd);
      const all = S.shuffleHands(p, b, 3, rnd);
      const cp = S.clearPlayerHand(p, 2);
      const ca = S.clearHands(p, 2);
      const playerKeepOne = json(one.players[0]) === json(p[0]) && json(one.players[2]) === json(p[2]) && json(one.players[3]) === json(p[3]);
      const oneFresh = one.players[1].length === 2 && one.players[1].every((c) => c >= 0) && new Set(one.players[1]).size === 2 &&
        one.players[1].every((c) => !p.flat().includes(c) && !b.includes(c));
      const allKeepHidden = json(all.players[3]) === json(p[3]) && all.players.slice(0, 3).flat().every((c) => c >= 0);
      const allUnique = new Set(all.players.slice(0, 3).flat().concat(b.filter((c) => c >= 0))).size === 6 + b.filter((c) => c >= 0).length;
      const clearOne = json(cp.players[2]) === json([-1, -1]) && json(cp.players[0]) === json(p[0]);
      const clearAll = json(ca.players[0]) === json([-1, -1]) && json(ca.players[1]) === json([-1, -1]) && json(ca.players[2]) === json(p[2]) && json(ca.players[3]) === json(p[3]);
      check('Hand操作: 個別/全体の引き直し・消去が対象だけを変更する', playerKeepOne && oneFresh && allKeepHidden && allUnique && clearOne && clearAll, '');
    }
    // ボード消去: プレイヤーを変えず、Boardだけを空にする
    {
      const p = blank(); p[0] = H('As', 'Kd'); p[2] = H('Qh', 'Qs');
      const b = cards('2c 3c 4c 5c 6c');
      const r = S.clearBoard(p, b);
      const playerKeep = json(r.players) === json(p) && json(p) === json([H('As','Kd'),[-1,-1],H('Qh','Qs'),[-1,-1]]);
      const boardClear = json(r.board) === json([-1, -1, -1, -1, -1]);
      const inputKeep = json(b) === json(cards('2c 3c 4c 5c 6c'));
      check('ボード消去: プレイヤーと元の入力を変えず、Boardだけを消去する', playerKeep && boardClear && inputKeep, json(r.board));
    }
    // ストリート単位のボード消去: 対象から後ろだけを消す
    {
      const p = blank(); p[0] = H('As', 'Kd'); p[1] = H('Qh', 'Qs');
      const b = cards('2c 3c 4c 5c 6c');
      const f = S.clearBoardStreet(p, b, 0);
      const t = S.clearBoardStreet(p, b, 1);
      const r = S.clearBoardStreet(p, b, 2);
      const ok = json(f.players) === json(p) && json(t.players) === json(p) && json(r.players) === json(p) &&
        json(f.board) === json([-1, -1, -1, -1, -1]) &&
        json(t.board) === json([b[0], b[1], b[2], -1, -1]) &&
        json(r.board) === json([b[0], b[1], b[2], b[3], -1]) &&
        json(b) === json(cards('2c 3c 4c 5c 6c'));
      check('Board操作: Flop/Turn/Riverの×はその位置から後ろを消去する', ok, '');
    }
    // ボード引き直し: プレイヤーを変えず、5枚を重複なく再抽選する
    {
      let seed = 123456;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const p = blank(); p[0] = H('As', 'Kd'); p[2] = H('Qh', 'Qs'); p[3] = H('Jc', 'Jd');
      const b = cards('2c 3c 4c 5c 6c');
      const r = S.shuffleBoard(p, b, rnd);
      const playerKeep = json(r.players) === json(p) && json(p) === json([H('As','Kd'),[-1,-1],H('Qh','Qs'),H('Jc','Jd')]);
      const inputKeep = json(b) === JSON.stringify(cards('2c 3c 4c 5c 6c'));
      const five = r.board.length === 5 && r.board.every((c) => c >= 0) && new Set(r.board).size === 5;
      const noOverlap = r.board.every((c) => !p.flat().includes(c));
      check('ボード引き直し: プレイヤーと元の入力を変えず、重複しない5枚を再抽選する', playerKeep && inputKeep && five && noOverlap, json(r.board));
    }
    // 保存データ: 人数を減らして隠れているP3・P4のカードも、読み込みで消えない (リロードで戻る)
    {
      const p = blank(); p[0] = H('As', 'Kd'); p[1] = H('Qh', 'Qs'); p[2] = H('2c', '3c'); p[3] = H('9d', '9h');
      const r = S.normalizeSaved({ mode: 'known', n: 2, opp: 1, players: p, board: [-1, -1, -1, -1, -1] });
      const dupHidden = blank(); dupHidden[0] = H('As', 'Kd'); dupHidden[2] = H('As', '3c'); // 隠れたP3が P1 と重複
      const r2 = S.normalizeSaved({ mode: 'known', n: 2, opp: 1, players: dupHidden, board: [-1, -1, -1, -1, -1] });
      const ok = r && json(r.players) === json(p) && r.n === 2 &&
        r2 && json(r2.players[2]) === json([-1, card('3c')]);
      check('保存データ: 人数を減らして隠れたP3・P4も保持(リロードで戻る)/ 重複だけ整理', !!ok, r ? json(r.players) : 'null');
    }
    // おまかせ配布: 入力済みは変えず、空欄だけを、いまのストリートまで埋める
    {
      let seed = 777;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const p = blank(); p[0] = H('As', 'Kd'); p[2] = H('2c', '3c'); p[3] = H('9h', '9d'); // P3・P4 は「隠れている」想定 (shown = 2)
      const flop = [card('Qs'), -1, -1, -1, -1];
      const r = S.fillEmpty(p, flop, 2, rnd);
      const shown = r.players.slice(0, 2).flat().concat(r.board.filter((c) => c >= 0));
      const keep = r.players[0][0] === card('As') && r.players[0][1] === card('Kd') && r.board[0] === card('Qs');
      const full = r.players[0].concat(r.players[1]).every((c) => c >= 0) && r.board.slice(0, 3).every((c) => c >= 0);
      const range = r.board[3] === -1 && r.board[4] === -1; // Flop までしか埋めない
      const uniq = new Set(shown).size === shown.length;
      const hidden = json(r.players[2]) === json(p[2]) && json(r.players[3]) === json(p[3]) && json(p[1]) === json([-1, -1]); // 隠れた分は触らない / 入力は変更しない
      const pre = S.fillEmpty(blank(), [-1, -1, -1, -1, -1], 3, rnd);
      const turn = S.fillEmpty(blank(), [card('2c'), card('3c'), card('4c'), card('5c'), -1], 2, rnd);
      const river = S.fillEmpty(blank(), [-1, -1, -1, -1, card('Ah')], 2, rnd);
      const streets = pre.board.every((c) => c === -1) && pre.players.slice(0, 3).flat().every((c) => c >= 0) && pre.players[3][0] === -1 &&
        turn.board.slice(0, 4).every((c) => c >= 0) && turn.board[4] === -1 &&
        river.board.every((c) => c >= 0);
      check('おまかせ配布: 入力済みは変えず、空欄だけを、いまのストリートまで埋める(重複なし)', keep && full && range && uniq && hidden && streets, '');
    }
    return allOk;
  }

  /* ---------- 計算速度 ---------- */
  async function bench() {
    const four = ['As Ks', 'Qh Qc', 'Jd Td', '9c 9d'].map(cards);
    const two = ['As Ks', 'Qh Qd'].map(cards);
    const rows = [
      ['プリフロップ 4人', four, ''],
      ['プリフロップ 2人', two, ''],
      ['フロップ 4人', four, '8s 7s 2d'],
      ['ターン 4人', four, '8s 7s 2d 3h'],
      ['リバー 4人', four, '8s 7s 2d 3h 4c'],
    ];
    head('厳密計算(Exact)の所要時間');
    for (const [name, hands, b] of rows) {
      await tick();
      const t0 = performance.now();
      const r = E.exactSync(hands, cards(b));
      const ms = performance.now() - t0;
      const [label, st] = ms < 1000 ? ['快適', 'ok'] : ms < 3000 ? ['実用的', 'ok'] : ms < 6000 ? ['やや遅い', 'info'] : ['遅い', 'ng'];
      row(st, `${name}: ${ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + '秒'}(${label})`,
        `${num(r.total)}通りを全て計算`);
    }
    await tick();
    const t0 = performance.now();
    E.monteCarlo(four, [], 100000, { seed: 1 });
    row('info', `参考: 近似計算 10万回(4人プリフロップ): ${Math.round(performance.now() - t0)}ms`, '');
    const note = document.createElement('div');
    note.className = 'd'; note.style.marginTop = '10px';
    note.textContent = '目安: 1秒未満=快適 / 3秒未満=実用的 / 6秒以上=遅い(実機で遅い場合は計算の別スレッド化を検討)';
    out.appendChild(note);
    const ua = document.createElement('details');
    ua.innerHTML = `<summary class="d">測定した端末</summary><pre class="d">${navigator.userAgent}</pre>`;
    out.appendChild(ua);
  }

  /* ---------- ボタン ---------- */
  document.getElementById('runAll').onclick = async () => {
    setBusy(true); out.innerHTML = '';
    const sum = summary();
    const results = [];
    head('① 役の判定');
    results.push(await testFiveCardDistribution());
    results.push(await testEvaluatorsAgree());
    head('② 勝率の計算');
    results.push(await testCases());
    head('③ ランダム相手(1人モード)');
    results.push(await testVsRandom());
    head('④ 最終役');
    results.push(await testFinalHands());
    head('⑤ 入力状態の整理');
    results.push(await testStateHelpers());
    const ok = results.every(Boolean);
    sum.className = 'vsum ' + (ok ? 'ok' : 'ng');
    sum.textContent = ok ? '✓ すべて合格' : '✕ 不合格の項目があります';
    setBusy(false);
  };
  document.getElementById('runBench').onclick = async () => {
    setBusy(true); out.innerHTML = '';
    await bench();
    setBusy(false);
  };
})();

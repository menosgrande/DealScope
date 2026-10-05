/* verify.js — 検証専用 (index.html の「検証」パネルを開いたときだけ読み込まれる)
 *
 * 「計算が正しいか確認」
 *   ① 役の判定: 5枚役の全分布を、公表されている件数と照合 / 別方式の評価器と勝敗を照合
 *   ② 勝率の計算: 既知ケースで 正解値 ・ Exact ・ Monte Carlo を比較
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

/* engine.js — カード勝率エンジン (UI非依存・外部依存なし)
 *
 * カード表現: 0..51 の整数。 rank = c >> 2 (0=2 … 12=A), suit = c & 3 (0=♠ 1=♥ 2=♦ 3=♣)
 * 勝率の定義: 引き分けは取り分を等分 (ポット分配を考慮したequity相当)
 *
 * 構成
 *   evaluate()    5〜7枚の役評価 (大きいほど強い)
 *   exactGen()    完全列挙 (generator: 時間分割で実行できる)
 *   exactSync()   完全列挙 (最後まで一気に実行)
 *   monteCarlo()  検証用。ランアウト生成・試行管理・集計は exact とは別コードパス
 *
 * 最終役の分布 (cats)
 *   各計算の戻り値に cats を持つ。cats[p][k] = 「全パターン(試行)のうち、プレイヤー p の最終役が
 *   カテゴリ k だった割合(%)」。k は evaluate() のカテゴリ(0 high … 8 straight flush)。
 *   「その役で勝つ確率」ではない。勝率の計算と同じ走査の副産物として数えるだけで、勝率は変わらない。
 */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = ['♠', '♥', '♦', '♣'];
  const cardName = (c) => RANKS[c >> 2] + SUITS[c & 3];

  /* ---------- 役評価 ----------
   * score = category<<20 | 5つの4bitキッカー
   * category: 0 high / 1 pair / 2 two pair / 3 trips / 4 straight /
   *           5 flush / 6 full house / 7 quads / 8 straight flush
   */
  const rc = new Int8Array(13);
  const sm = new Int32Array(4);
  const sn = new Int32Array(4);

  function straightHigh(mask) {
    const m = (mask << 1) | (mask >> 12); // bit0 = A(ローカード用)
    for (let h = 13; h >= 4; h--) {
      if (((m >> (h - 4)) & 31) === 31) return h - 1;
    }
    return -1;
  }
  function topN(mask, n) {
    let v = 0, k = 0;
    for (let r = 12; r >= 0 && k < n; r--) {
      if ((mask >> r) & 1) { v = (v << 4) | r; k++; }
    }
    return v << (4 * (n - k));
  }
  function kick(e1, e2, n) {
    let v = 0, k = 0;
    for (let r = 12; r >= 0 && k < n; r--) {
      if (rc[r] > 0 && r !== e1 && r !== e2) { v = (v << 4) | r; k++; }
    }
    return v << (4 * (n - k));
  }

  function evaluate(a) {
    const n = a.length;
    rc.fill(0);
    sm[0] = sm[1] = sm[2] = sm[3] = 0;
    sn[0] = sn[1] = sn[2] = sn[3] = 0;
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const c = a[i], r = c >> 2, s = c & 3;
      rc[r]++; mask |= 1 << r; sm[s] |= 1 << r; sn[s]++;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (sn[s] >= 5) { fs = s; break; }
    if (fs >= 0) {
      const sh = straightHigh(sm[fs]);
      if (sh >= 0) return (8 << 20) | (sh << 16);
    }
    let q = -1, t = -1, t2 = -1, p1 = -1, p2 = -1;
    for (let r = 12; r >= 0; r--) {
      const c = rc[r];
      if (c === 4) { if (q < 0) q = r; }
      else if (c === 3) { if (t < 0) t = r; else if (t2 < 0) t2 = r; }
      else if (c === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
    }
    if (q >= 0) return (7 << 20) | (q << 16) | (kick(q, -1, 1) << 12);
    if (t >= 0 && (t2 >= 0 || p1 >= 0)) {
      const pr = t2 > p1 ? t2 : p1;
      return (6 << 20) | (t << 16) | (pr << 12);
    }
    if (fs >= 0) return (5 << 20) | topN(sm[fs], 5);
    const sh = straightHigh(mask);
    if (sh >= 0) return (4 << 20) | (sh << 16);
    if (t >= 0) return (3 << 20) | (t << 16) | (kick(t, -1, 2) << 8);
    if (p2 >= 0) return (2 << 20) | (p1 << 16) | (p2 << 12) | (kick(p1, p2, 1) << 8);
    if (p1 >= 0) return (1 << 20) | (p1 << 16) | (kick(p1, -1, 3) << 4);
    return topN(mask, 5);
  }

  function choose(n, k) {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }

  // 回数の配列 (P人 × 9カテゴリ) → 割合(%)の配列
  function catPct(counts, P, denom) {
    const r = [];
    for (let p = 0; p < P; p++) {
      const row = [];
      for (let k = 0; k < 9; k++) row.push((counts[p * 9 + k] / denom) * 100);
      r.push(row);
    }
    return r;
  }

  /* ---------- Exact (完全列挙) ----------
   * hands: [[c,c], ...]  board: 0〜5枚
   * yield: 進捗(0〜1) / return: { equity:[%...], cats:[[9カテゴリの%]...], total }
   */
  function* exactGen(hands, board, opts) {
    const evalFn = (opts && opts.evalFn) || evaluate;
    const P = hands.length, bl = board.length, m = 5 - bl;
    const dead = new Uint8Array(52);
    for (const h of hands) { dead[h[0]] = 1; dead[h[1]] = 1; }
    for (const c of board) dead[c] = 1;
    const deck = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);
    const n = deck.length;
    const total = choose(n, m);

    const cnt = new Float64Array(P * 5); // [p*5 + w] = 「w人同点で勝った」回数
    const cat = new Float64Array(P * 9); // [p*9 + k] = 最終役がカテゴリ k だった回数
    const sc = new Array(P);
    const tmp = new Array(7);
    const bd = board.slice();
    const idx = [];
    for (let j = 0; j < m; j++) { bd.push(0); idx.push(j); }
    let done = 0;

    for (;;) {
      for (let j = 0; j < m; j++) bd[bl + j] = deck[idx[j]];
      for (let k = 0; k < 5; k++) tmp[2 + k] = bd[k];
      let best = -1, w = 0;
      for (let p = 0; p < P; p++) {
        tmp[0] = hands[p][0]; tmp[1] = hands[p][1];
        const s = evalFn(tmp);
        sc[p] = s;
        cat[p * 9 + (s >>> 20)]++;
        if (s > best) { best = s; w = 1; } else if (s === best) w++;
      }
      for (let p = 0; p < P; p++) if (sc[p] === best) cnt[p * 5 + w]++;
      done++;
      if ((done & 8191) === 0) yield done / total;

      let i = m - 1;
      while (i >= 0 && idx[i] === n - m + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < m; j++) idx[j] = idx[j - 1] + 1;
    }

    const equity = [];
    for (let p = 0; p < P; p++) {
      let e = 0;
      for (let w = 1; w <= 4; w++) e += cnt[p * 5 + w] / w;
      equity.push((e / total) * 100);
    }
    return { equity, cats: catPct(cat, P, total), total };
  }

  function exactSync(hands, board, opts) {
    const g = exactGen(hands, board, opts);
    for (;;) { const r = g.next(); if (r.done) return r.value; }
  }

  /* ---------- Monte Carlo (検証用) ----------
   * exact とは独立: 乱数・ランアウト生成(部分Fisher-Yates)・試行管理・集計を別実装。
   */
  function monteCarlo(hands, board, trials, opts) {
    opts = opts || {};
    const evalFn = opts.evalFn || evaluate;
    let seed = (opts.seed >>> 0) || ((Math.random() * 4294967296) >>> 0) || 1;
    const next = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      seed >>>= 0;
      return seed;
    };

    const known = new Set();
    hands.forEach((h) => { known.add(h[0]); known.add(h[1]); });
    board.forEach((c) => known.add(c));
    const pool = [];
    for (let c = 0; c < 52; c++) if (!known.has(c)) pool.push(c);
    const need = 5 - board.length;
    const P = hands.length;

    const sole = new Array(P).fill(0);   // 単独勝利の回数
    const split = new Array(P).fill(0);  // 引き分け時の取り分の合計
    const cat = new Float64Array(P * 9); // 最終役のカテゴリ別の回数
    const seven = new Array(7);

    for (let t = 0; t < trials; t++) {
      for (let j = 0; j < need; j++) {
        const k = j + Math.floor((next() / 4294967296) * (pool.length - j));
        const tmpc = pool[j]; pool[j] = pool[k]; pool[k] = tmpc;
      }
      for (let k = 0; k < board.length; k++) seven[2 + k] = board[k];
      for (let j = 0; j < need; j++) seven[2 + board.length + j] = pool[j];

      let best = -1;
      const scores = [];
      for (let p = 0; p < P; p++) {
        seven[0] = hands[p][0]; seven[1] = hands[p][1];
        const s = evalFn(seven);
        scores.push(s);
        cat[p * 9 + (s >>> 20)]++;
        if (s > best) best = s;
      }
      let winners = 0;
      for (let p = 0; p < P; p++) if (scores[p] === best) winners++;
      for (let p = 0; p < P; p++) {
        if (scores[p] !== best) continue;
        if (winners === 1) sole[p]++; else split[p] += 1 / winners;
      }
    }
    const equity = sole.map((w, p) => ((w + split[p]) / trials) * 100);
    return { equity, cats: catPct(cat, P, trials), trials };
  }

  /* ---------- ランダム相手 (Hero 1人 vs ランダムな相手1人) ----------
   * 相手の2枚は、Heroとボードを除いた残りデックから一様にランダム。
   */

  // Exact (Flop以降): 相手の全2枚組み合わせ × 未公開ボードの全列挙。各組み合わせは等確率
  function* exactVsRandomGen(hero, board, opts) {
    const evalFn = (opts && opts.evalFn) || evaluate;
    const bl = board.length, m = 5 - bl;
    const dead = new Uint8Array(52);
    dead[hero[0]] = 1; dead[hero[1]] = 1;
    for (const c of board) dead[c] = 1;
    const deck = [];
    for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);
    const n = deck.length, rn = n - 2;
    const total = choose(n, 2) * choose(rn, m);

    let win = 0, tie = 0, done = 0;
    const hc = new Float64Array(9), oc = new Float64Array(9); // Hero / 相手の最終役のカテゴリ別の回数
    const rest = new Array(rn);
    const hs = new Array(7), os = new Array(7);
    hs[0] = hero[0]; hs[1] = hero[1];
    const bd = board.slice();
    for (let j = 0; j < m; j++) bd.push(0);
    const idx = new Array(m);

    for (let a = 0; a < n - 1; a++) {
      for (let b = a + 1; b < n; b++) {
        let k = 0;
        for (let i = 0; i < n; i++) if (i !== a && i !== b) rest[k++] = deck[i];
        os[0] = deck[a]; os[1] = deck[b];
        for (let j = 0; j < m; j++) idx[j] = j;
        for (;;) {
          for (let j = 0; j < m; j++) bd[bl + j] = rest[idx[j]];
          for (let q = 0; q < 5; q++) { hs[2 + q] = bd[q]; os[2 + q] = bd[q]; }
          const h = evalFn(hs), o = evalFn(os);
          hc[h >>> 20]++; oc[o >>> 20]++;
          if (h > o) win++; else if (h === o) tie++;
          done++;
          if ((done & 8191) === 0) yield done / total;
          let i = m - 1;
          while (i >= 0 && idx[i] === rn - m + i) i--;
          if (i < 0) break;
          idx[i]++;
          for (let j = i + 1; j < m; j++) idx[j] = idx[j - 1] + 1;
        }
      }
    }
    // cats = [Hero, 相手]
    return { equity: [((win + tie / 2) / total) * 100], cats: [catPct(hc, 1, total)[0], catPct(oc, 1, total)[0]], total };
  }

  // Monte Carlo: Hero vs ランダムな相手 opps人(1〜4)。Exact とは別コードパス
  // 約4096試行ごとに進捗を yield する(時間分割で実行できる)
  function* monteCarloVsRandomGen(hero, board, opps, trials, opts) {
    opts = opts || {};
    const evalFn = opts.evalFn || evaluate;
    let seed = (opts.seed >>> 0) || ((Math.random() * 4294967296) >>> 0) || 1;
    const next = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      seed >>>= 0;
      return seed;
    };
    const known = new Set([hero[0], hero[1], ...board]);
    const pool = [];
    for (let c = 0; c < 52; c++) if (!known.has(c)) pool.push(c);
    const bl = board.length, need = 5 - bl, draw = 2 * opps + need;
    const hs = new Array(7);
    const os = [];
    for (let o = 0; o < opps; o++) os.push(new Array(7));
    hs[0] = hero[0]; hs[1] = hero[1];
    for (let k = 0; k < bl; k++) {
      hs[2 + k] = board[k];
      for (let o = 0; o < opps; o++) os[o][2 + k] = board[k];
    }

    let sole = 0, split = 0;
    const hc = new Float64Array(9), oc = new Float64Array(9); // Hero / 相手(全員ぶん合計)の最終役のカテゴリ別の回数
    for (let t = 0; t < trials; t++) {
      for (let j = 0; j < draw; j++) {
        const k = j + Math.floor((next() / 4294967296) * (pool.length - j));
        const tmpc = pool[j]; pool[j] = pool[k]; pool[k] = tmpc;
      }
      for (let o = 0; o < opps; o++) { os[o][0] = pool[2 * o]; os[o][1] = pool[2 * o + 1]; }
      for (let j = 0; j < need; j++) {
        const v = pool[2 * opps + j];
        hs[2 + bl + j] = v;
        for (let o = 0; o < opps; o++) os[o][2 + bl + j] = v;
      }
      const h = evalFn(hs);
      hc[h >>> 20]++;
      let beaten = false, ties = 0;
      for (let o = 0; o < opps; o++) { // 最終役を数えるため、Heroが負けた後も全員を評価する (勝率の結果は変わらない)
        const s = evalFn(os[o]);
        oc[s >>> 20]++;
        if (s > h) beaten = true;
        else if (s === h) ties++;
      }
      if (!beaten) { if (ties === 0) sole++; else split += 1 / (ties + 1); }
      if (((t + 1) & 4095) === 0) yield (t + 1) / trials;
    }
    // cats = [Hero, 相手(1人あたり)]
    return {
      equity: [((sole + split) / trials) * 100],
      cats: [catPct(hc, 1, trials)[0], catPct(oc, 1, trials * opps)[0]],
      trials,
    };
  }

  function monteCarloVsRandom(hero, board, trials, opts) {
    const g = monteCarloVsRandomGen(hero, board, (opts && opts.opponents) || 1, trials, opts);
    for (;;) { const r = g.next(); if (r.done) return r.value; }
  }

  /* ---------- 最強の5枚 ----------
   * cards(5〜7枚)から最強の5枚組を返す。同点の組は配列の前方のカードを優先する
   * (呼び出し側は「ボード → ホールカード」の順で渡す。ボードだけで成立する役ではホールカードを光らせないため)。
   */
  function bestFive(cards) {
    const n = cards.length;
    let best = -1, bestCards = null;
    const idx = [0, 1, 2, 3, 4];
    const five = new Array(5);
    for (;;) {
      for (let k = 0; k < 5; k++) five[k] = cards[idx[k]];
      const s = evaluate(five);
      if (s > best) { best = s; bestCards = five.slice(); }
      let i = 4;
      while (i >= 0 && idx[i] === n - 5 + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < 5; j++) idx[j] = idx[j - 1] + 1;
    }
    return { score: best, cards: bestCards };
  }

  const api = { RANKS, SUITS, cardName, evaluate, exactGen, exactSync, monteCarlo, exactVsRandomGen, monteCarloVsRandomGen, monteCarloVsRandom, bestFive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokerEq = api;
})(typeof window !== 'undefined' ? window : globalThis);

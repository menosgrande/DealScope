/* state.js — 入力状態の純関数 (UI非依存・外部依存なし)
 *
 * app.js から切り出した「DOMに触らない部分」。verify.js で検証できるようにするため。
 *
 * 状態のかたち (snapshot)
 *   mode    : 'known' | 'random'
 *   n       : 既知ハンドの人数 (2〜4)。ランダム相手モードの間も保持する
 *   opp     : ランダム相手の人数 (1〜4)
 *   players : [[c,c] × 4]   -1 = 未入力。ランダム相手モードでは players[0] = Hero
 *             (= 既知ハンドの P1 と共有)。players[1〜n-1] は画面に出ないが保持する
 *   board   : [c × 5]       [0..2]=Flop, [3]=Turn, [4]=River
 *
 * 「人数変更」と「モードを切り替える」は別処理:
 *   人数変更 → 表示人数だけを変え、隠れたP3〜P4のカードは保持する (app.js の setCount)
 *   モード切替 → 破棄しない。重複があれば dedupe() で整理する
 */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA'; // engine.js と同じ並び (rank = c >> 2)

  const emptyHands = () => [[-1, -1], [-1, -1], [-1, -1], [-1, -1]];
  const emptyBoard = () => [-1, -1, -1, -1, -1];

  /* ---------- 重複カードの整理 ----------
   * 先に出てくるカードを残し、後ろの重複を空欄 (-1) にする。
   * 優先順位: Board → P1(Hero) → P2 → P3 → P4
   *   = 画面に出ていたもの (Board・Hero) を守り、隠れていた P2〜P4 だけを整理する。
   * 入力は変更せず、新しい配列を返す。
   */
  function dedupe(board, players) {
    const seen = new Set();
    const keep = (c) => {
      if (c < 0 || seen.has(c)) return -1;
      seen.add(c);
      return c;
    };
    const b = board.map(keep);
    const p = players.map((h) => h.map(keep));
    return { board: b, players: p };
  }

  /* ---------- URL ----------
   * 既知ハンド:   #P1-P2[-P3[-P4]]/Flop/Turn/River     例: #AdTs-2c7h/Kh7d3s/Qc/2h
   * ランダム相手: #Hero-??[-??…]/Flop/Turn/River        例: #AdTs-??-??/Kh7d3s   (?? = ランダムな相手1人)
   * カードは「ランク(A K Q J T 9…2)+スート(s h d c)」の2文字、空欄は xx。末尾の空欄は省略。
   * URLには「いま表示しているモードの入力」だけを入れる (隠れているP2〜P4は入れない)。
   */
  const tok = (c) => (c < 0 ? 'xx' : RANKS[c >> 2] + 'shdc'[c & 3]);
  function trimTok(arr) {
    const t = arr.map(tok);
    while (t.length && t[t.length - 1] === 'xx') t.pop();
    return t.join('');
  }

  function encode(s) {
    let hs;
    if (s.mode === 'random') {
      hs = [trimTok(s.players[0]) || 'xx'].concat(new Array(s.opp).fill('??')).join('-');
    } else {
      const hands = [];
      for (let i = 0; i < s.n; i++) hands.push(trimTok(s.players[i]));
      hs = hands.join('-');
    }
    const segs = [trimTok(s.board.slice(0, 3)), trimTok([s.board[3]]), trimTok([s.board[4]])];
    while (segs.length && segs[segs.length - 1] === '') segs.pop();
    if (!segs.length && s.mode === 'known' && s.n === 2 && hs === '-') return ''; // 何も入力していない初期状態
    return '#' + hs + (segs.length ? '/' + segs.join('/') : '');
  }

  /* 不正なら null。ランダム相手のURLは n = 2 (既知ハンドの人数は URL からは分からない) */
  function decode(hash) {
    const body = String(hash).replace(/^#/, '');
    if (!body) return null;
    const parts = body.split('/');
    if (parts.length > 4) return null;
    const hs = parts[0].split('-');
    let mode, n, opp = 1;
    if (hs.length === 1 || hs.slice(1).every((x) => x === '??')) { // ランダム相手 (Hero のみのURLも受け付ける)
      mode = 'random';
      n = 2;
      opp = Math.max(1, hs.length - 1);
      if (opp > 4) return null;
    } else {
      mode = 'known';
      n = hs.length;
      if (n < 2 || n > 4 || hs.includes('??')) return null;
    }
    const toks = (str) => {
      if (str.length % 2) return null;
      const r = [];
      for (let i = 0; i < str.length; i += 2) {
        const t = str.slice(i, i + 2).toLowerCase();
        if (t === 'xx') { r.push(-1); continue; }
        const rk = '23456789tjqka'.indexOf(t[0]), su = 'shdc'.indexOf(t[1]);
        if (rk < 0 || su < 0) return null;
        r.push(rk * 4 + su);
      }
      return r;
    };
    const pad = (a, len) => { while (a.length < len) a.push(-1); return a; };
    const shown = mode === 'random' ? 1 : n; // URL に入っているプレイヤー数
    const players = [];
    for (let i = 0; i < 4; i++) {
      const t = i < shown ? toks(hs[i]) : [];
      if (!t || t.length > 2) return null;
      players.push(pad(t, 2));
    }
    const flop = toks(parts[1] || ''), turn = toks(parts[2] || ''), river = toks(parts[3] || '');
    if (!flop || !turn || !river || flop.length > 3 || turn.length > 1 || river.length > 1) return null;
    return { mode, n, opp, players, board: [...pad(flop, 3), ...pad(turn, 1), ...pad(river, 1)] };
  }

  /* ---------- 端末の保存内容 ----------
   * 壊れていたら null。旧形式 (mode が無く、n === 1 がランダム相手) も読める。
   * 重複カードは dedupe() で整理する。n 人より後ろ(隠れている)のプレイヤーのカードは保持する。
   */
  function normalizeSaved(d) {
    if (!d || typeof d !== 'object') return null;
    let mode, n;
    if (d.mode === 'known' || d.mode === 'random') { mode = d.mode; n = d.n; }
    else if (d.n === 1) { mode = 'random'; n = 2; }
    else { mode = 'known'; n = d.n; }
    if (![2, 3, 4].includes(n)) return null;
    const ok = (c) => Number.isInteger(c) && c >= -1 && c < 52;
    if (!Array.isArray(d.players) || d.players.length !== 4 ||
        !d.players.every((p) => Array.isArray(p) && p.length === 2 && p.every(ok))) return null;
    if (!Array.isArray(d.board) || d.board.length !== 5 || !d.board.every(ok)) return null;
    const opp = Number.isInteger(d.opp) && d.opp >= 1 && d.opp <= 4 ? d.opp : 1;
    const c = dedupe(d.board, d.players); // 隠れているプレイヤー(n 人より後ろ)のカードも保持し、重複だけ整理する
    return { mode, n, opp, players: c.players, board: c.board };
  }

  /* ---------- ボード消去 ----------
   * プレイヤーのカードは変えず、Boardだけを空にする。入力は変更せず、新しい配列を返す。
   */
  function clearBoard(players, board) {
    return { players: players.map((h) => h.slice()), board: emptyBoard() };
  }

  /* ---------- ボードの引き直し ----------
   * プレイヤーのカードは変えず、ボード5枚を残りデックからランダムに引き直す。
   * 隠れているP2〜P4のカードもデックから除外する。入力は変更せず、新しい配列を返す。
   */
  function shuffleBoard(players, board, rnd) {
    const used = new Set();
    players.forEach((h) => h.forEach((c) => { if (c >= 0) used.add(c); }));
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return { players: players.map((h) => h.slice()), board: deck.slice(0, 5) };
  }

  /* ---------- ストリート単位のボード引き直し ----------
   * street: 0 = Flop(0..2), 1 = Turn(3), 2 = River(4)
   * プレイヤーと、対象ストリート以外のボードを固定したまま、対象部分だけを残りデックから引き直す。
   * 入力は変更せず、新しい配列を返す。
   */
  function shuffleBoardStreet(players, board, street, rnd) {
    if (![0, 1, 2].includes(street)) return { players: players.map((h) => h.slice()), board: board.slice() };
    const ps = players.map((h) => h.slice());
    const b = board.slice();
    const target = street === 0 ? [0, 1, 2] : [street === 1 ? 3 : 4];
    const targetSet = new Set(target);
    const used = new Set();
    ps.forEach((h) => h.forEach((c) => { if (c >= 0) used.add(c); }));
    b.forEach((c) => { if (c >= 0) used.add(c); });
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    target.forEach((i) => { b[i] = deck.pop(); });
    return { players: ps, board: b };
  }

  /* ---------- おまかせ配布 ----------
   * 空欄だけをランダムなカードで埋める。入力済みのカードは変えない。
   *   埋める範囲: 画面に出ているプレイヤー(shown 人)のホールカード + いまのストリートまでのボード
   *   いまのストリート: River入力済み → 5枚 / Turn入力済み → 4枚 / Flopに1枚でもある → 3枚 / 何もない → 0枚(Preflop)
   *   使えるカード: 画面に出ている枠 + 隠れているP2〜P4で既に使われていないカード
   * rnd: 0以上1未満の乱数を返す関数 (検証では固定の乱数を渡せる)。入力は変更せず、新しい配列を返す。
   */
  function fillEmpty(players, board, shown, rnd) {
    const ps = players.map((h) => h.slice());
    const b = board.slice();
    const used = new Set();
    // 画面に出ていないP2〜P4も、すでに保存されているカードはデッキから除外する。
    // ただし補充するのは visible な shown 人だけ。
    ps.forEach((h) => h.forEach((c) => { if (c >= 0) used.add(c); }));
    b.forEach((c) => { if (c >= 0) used.add(c); });
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    const target = b[4] >= 0 ? 5 : b[3] >= 0 ? 4 : b.slice(0, 3).some((c) => c >= 0) ? 3 : 0;
    for (let i = 0; i < shown; i++) for (let j = 0; j < 2; j++) if (ps[i][j] < 0) ps[i][j] = deck.pop();
    for (let j = 0; j < target; j++) if (b[j] < 0) b[j] = deck.pop();
    return { players: ps, board: b };
  }

  const api = { RANKS, emptyHands, emptyBoard, dedupe, encode, decode, normalizeSaved, fillEmpty, shuffleBoard, shuffleBoardStreet, clearBoard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DealState = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* app.js — 入力UI / カード状態 / 結果表示 */
(function () {
  'use strict';
  const E = window.PokerEq;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'card-equity-state-v1';
  const RANDOM_TRIALS = 100000; // ランダム相手(近似)の試行回数

  /* ---------- カード状態 ----------
   * n   : 表示するプレイヤー数。1 = ランダム相手モード(Heroのみ入力)、2〜4 = 既知ハンドモード
   * opp : ランダム相手モードの相手の人数(1〜4)
   */
  const state = {
    n: 2,
    opp: 1,
    players: [[-1, -1], [-1, -1], [-1, -1], [-1, -1]],
    board: [-1, -1, -1, -1, -1], // [0..2]=Flop, [3]=Turn, [4]=River
    active: { t: 'p', i: 0, j: 0 },
    open: false,
  };

  const isRandom = () => state.n === 1;
  const pname = (i) => (isRandom() ? 'Hero' : 'Player ' + (i + 1));

  function slots() {
    const a = [];
    for (let i = 0; i < state.n; i++) { a.push({ t: 'p', i, j: 0 }); a.push({ t: 'p', i, j: 1 }); }
    for (let j = 0; j < 5; j++) a.push({ t: 'b', j });
    return a;
  }
  const get = (s) => (s.t === 'p' ? state.players[s.i][s.j] : state.board[s.j]);
  function set(s, v) { if (s.t === 'p') state.players[s.i][s.j] = v; else state.board[s.j] = v; }
  const same = (a, b) => a.t === b.t && a.i === b.i && a.j === b.j;

  function usedCards() {
    const u = new Set();
    slots().forEach((s) => { const c = get(s); if (c >= 0) u.add(c); });
    return u;
  }
  function advance() {
    const list = slots();
    const k = list.findIndex((s) => same(s, state.active));
    for (let d = 1; d <= list.length; d++) {
      const s = list[(k + d + list.length) % list.length];
      if (get(s) < 0) { state.active = s; return true; }
    }
    return false;
  }
  const activeValid = () => slots().some((s) => same(s, state.active));
  function ensureActive() {
    if (activeValid()) return;
    const list = slots();
    state.active = list.find((s) => get(s) < 0) || list[0];
  }
  /* 人数・モード変更で入力中の枠が無くなったら、ピッカーを閉じて入力位置をプレイヤー側に戻す。
     (ボードへ勝手に移って、次のカードがボードに入るのを防ぐ) */
  function afterShrink() {
    if (activeValid()) return;
    state.open = false;
    const list = slots();
    state.active = list.find((s) => s.t === 'p' && get(s) < 0) || list[0];
  }
  function pick(c) {
    set(state.active, c);
    if (!advance()) state.open = false;
    render();
    recompute();
  }

  /* 人数を減らす / モードを切り替えるときは、いなくなったプレイヤーのカードを破棄する */
  function discardFrom(v) { for (let i = v; i < 4; i++) state.players[i] = [-1, -1]; }
  function setCount(v) {
    if (isRandom() || v < 2 || v > 4) return;
    discardFrom(v);
    state.n = v;
    afterShrink();
    render();
    recompute();
  }
  function setOpp(v) {
    if (!isRandom() || v < 1 || v > 4) return;
    state.opp = v;
    render();
    recompute();
  }
  function setMode(m) {
    if (m === 'random' && !isRandom()) { discardFrom(1); state.n = 1; }
    else if (m === 'known' && isRandom()) { state.n = 2; }
    else return;
    afterShrink();
    render();
    recompute();
  }

  /* ---------- URL / 保存 ----------
   * 既知ハンド:   #P1-P2[-P3[-P4]]/Flop/Turn/River     例: #AdTs-2c7h/Kh7d3s/Qc/2h
   * ランダム相手: #Hero-??[-??…]/Flop/Turn/River        例: #AdTs-??-??/Kh7d3s   (?? = ランダムな相手1人)
   * カードは「ランク(A K Q J T 9…2)+スート(s h d c)」の2文字、空欄は xx。末尾の空欄は省略。
   */
  const tok = (c) => (c < 0 ? 'xx' : E.RANKS[c >> 2] + 'shdc'[c & 3]);
  function trimTok(arr) {
    const t = arr.map(tok);
    while (t.length && t[t.length - 1] === 'xx') t.pop();
    return t.join('');
  }
  function encode() {
    let hs;
    if (isRandom()) {
      hs = [trimTok(state.players[0]) || 'xx'].concat(new Array(state.opp).fill('??')).join('-');
    } else {
      const hands = [];
      for (let i = 0; i < state.n; i++) hands.push(trimTok(state.players[i]));
      hs = hands.join('-');
    }
    const segs = [trimTok(state.board.slice(0, 3)), trimTok([state.board[3]]), trimTok([state.board[4]])];
    while (segs.length && segs[segs.length - 1] === '') segs.pop();
    if (!segs.length && !isRandom() && state.n === 2 && hs === '-') return ''; // 何も入力していない初期状態
    return '#' + hs + (segs.length ? '/' + segs.join('/') : '');
  }
  function decode(hash) {
    const body = String(hash).replace(/^#/, '');
    if (!body) return null;
    const parts = body.split('/');
    if (parts.length > 4) return null;
    const hs = parts[0].split('-');
    let n, opp = 1;
    if (hs.length === 1 || hs.slice(1).every((x) => x === '??')) { // ランダム相手モード(Hero のみのURLも受け付ける)
      n = 1;
      opp = Math.max(1, hs.length - 1);
      if (opp > 4) return null;
    } else {
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
    const players = [];
    for (let i = 0; i < 4; i++) {
      const t = i < n ? toks(hs[i]) : [];
      if (!t || t.length > 2) return null;
      players.push(pad(t, 2));
    }
    const flop = toks(parts[1] || ''), turn = toks(parts[2] || ''), river = toks(parts[3] || '');
    if (!flop || !turn || !river || flop.length > 3 || turn.length > 1 || river.length > 1) return null;
    return { n, opp, players, board: [...pad(flop, 3), ...pad(turn, 1), ...pad(river, 1)] };
  }
  function apply(d) {
    const seen = new Set();
    const clean = (c) => { if (c < 0 || seen.has(c)) return -1; seen.add(c); return c; };
    state.n = d.n;
    state.opp = d.opp >= 1 && d.opp <= 4 ? d.opp : 1;
    state.players = d.players.map((p, i) => (i < d.n ? p.map(clean) : [-1, -1]));
    state.board = d.board.map(clean);
    state.active = { t: 'p', i: 0, j: 0 };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ n: state.n, opp: state.opp, players: state.players, board: state.board }));
    } catch (e) { /* 保存できなくても動く */ }
    try { history.replaceState(null, '', encode() || location.pathname + location.search); } catch (e) { /* 無視 */ }
  }
  // URLがあればURLを優先。なければ(または不正なら)端末の保存内容から復元
  function load() {
    const fromUrl = location.hash.length > 1 ? decode(location.hash) : null;
    if (fromUrl) { apply(fromUrl); return; }
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!d || ![1, 2, 3, 4].includes(d.n)) return;
      const ok = (c) => Number.isInteger(c) && c >= -1 && c < 52;
      if (!Array.isArray(d.players) || d.players.length !== 4 || !d.players.every((p) => Array.isArray(p) && p.length === 2 && p.every(ok))) return;
      if (!Array.isArray(d.board) || d.board.length !== 5 || !d.board.every(ok)) return;
      apply(d);
    } catch (e) { /* 壊れた保存データは無視 */ }
  }

  /* ---------- 光るカード (今いちばん強いハンドを作る5枚) ---------- */
  let glow = new Set();
  function computeGlow() {
    glow = new Set();
    const board = boardCards();
    if (!board || board.length < 3) return;
    const made = [];
    for (let i = 0; i < state.n; i++) {
      const [a, b] = state.players[i];
      if (a < 0 || b < 0) return; // 全員そろっているときだけ
      made.push(E.bestFive(board.concat([a, b])));
    }
    const top = Math.max(...made.map((m) => m.score));
    made.forEach((m) => { if (m.score === top) m.cards.forEach((c) => glow.add(c)); });
  }

  /* ---------- 描画 ---------- */
  function slotHTML(s) {
    const c = get(s);
    const act = same(s, state.active) && state.open ? ' active' : '';
    const attr = `data-t="${s.t}" data-i="${s.i === undefined ? '' : s.i}" data-j="${s.j}"`;
    if (c < 0) return `<button class="slot empty${act}" ${attr} aria-label="未入力"></button>`;
    const g = glow.size ? (glow.has(c) ? ' hit' : ' off') : '';
    return `<button class="slot filled s${c & 3}${g}${act}" ${attr}>${E.RANKS[c >> 2]}<small>${E.SUITS[c & 3]}</small></button>`;
  }

  function slotLabel(s) {
    if (s.t === 'p') return `${pname(s.i)} — ${s.j + 1}枚目`;
    return s.j < 3 ? `Flop — ${s.j + 1}枚目` : s.j === 3 ? 'Turn' : 'River';
  }

  function render() {
    ensureActive();
    computeGlow();
    document.body.classList.toggle('picking', state.open);
    $('picker').hidden = !state.open;

    $('mode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === (isRandom() ? 'random' : 'known')));
    $('nlabel').textContent = isRandom() ? '相手 ' : '';
    $('nval').textContent = isRandom() ? state.opp : state.n;
    $('dec').disabled = isRandom() ? state.opp <= 1 : state.n <= 2;
    $('inc').disabled = isRandom() ? state.opp >= 4 : state.n >= 4;

    let ph = '';
    for (let i = 0; i < state.n; i++) {
      ph += `<div class="row"><div class="name">${pname(i)}</div><div class="slots">${slotHTML({ t: 'p', i, j: 0 })}${slotHTML({ t: 'p', i, j: 1 })}</div><div class="pr" data-i="${i}"></div></div>`;
    }
    $('players').innerHTML = ph;

    const grp = (label, js) =>
      `<div class="grp"><div class="slots">${js.map((j) => slotHTML({ t: 'b', j })).join('')}</div><div class="cap">${label}</div></div>`;
    $('board').innerHTML = `<div class="row"><div class="name">Board</div><div class="bslots">${grp('Flop', [0, 1, 2])}${grp('Turn', [3])}${grp('River', [4])}</div></div>`;

    if (state.open) {
      $('pickLabel').textContent = slotLabel(state.active);
      const used = usedCards();
      const cur = get(state.active);
      $('grid').querySelectorAll('button').forEach((b) => {
        const c = +b.dataset.c;
        b.disabled = used.has(c) && c !== cur;
        b.classList.toggle('cur', c === cur);
      });
      $('clear').style.visibility = cur >= 0 ? 'visible' : 'hidden';
    }
    renderResults(); // プレイヤー行を作り直すので、勝率も描き直す
  }

  function buildGrid() {
    let h = '';
    for (let s = 0; s < 4; s++) {
      for (let r = 12; r >= 0; r--) {
        h += `<button data-c="${r * 4 + s}" class="s${s}">${E.RANKS[r]}${E.SUITS[s]}</button>`;
      }
    }
    $('grid').innerHTML = h;
  }

  /* ---------- 結果 ---------- */
  let res = { mode: 'none', eq: [], approx: false };
  let job = 0;

  // 勝率は各プレイヤー行の右側(.pr)に表示。ボード下(#results)には補足の注記だけ出す
  function renderResults() {
    for (let i = 0; i < state.n; i++) {
      let txt = '—', w = 0;
      if (res.mode === 'calc') txt = '…';
      const done = res.mode === 'done' && res.eq[i] !== undefined; // 人数変更の直後は古い結果を使わない
      if (done) { txt = (res.approx ? '≈' : '') + res.eq[i].toFixed(1) + '%'; w = res.eq[i]; }
      const cell = $('players').querySelector(`.pr[data-i="${i}"]`);
      if (cell) {
        cell.innerHTML = `<div class="pct${done ? '' : ' dim'}">${txt}</div>` +
          `<div class="bar"><i style="width:${w}%"></i></div>`;
      }
    }
    let h = '';
    if (isRandom()) h += `<div class="note">vs ランダム${state.opp}人${res.mode === 'done' && res.approx ? '(近似値)' : ''}</div>`;
    if (res.mode === 'wait') h += '<div class="note">入力待ち — ボードはFlopの3枚がそろうと計算します</div>';
    $('results').innerHTML = h;
  }

  /* 計算できるボード: 0枚(Preflop) / Flop3枚 / +Turn / +River。それ以外は null */
  function boardCards() {
    const b = state.board;
    const f = b.slice(0, 3).filter((c) => c >= 0).length;
    const t = b[3] >= 0, r = b[4] >= 0;
    if (f === 0 && !t && !r) return [];
    if (f === 3 && !t && !r) return b.slice(0, 3);
    if (f === 3 && t && !r) return b.slice(0, 4);
    if (f === 3 && t && r) return b.slice(0, 5);
    return null;
  }

  function recompute() {
    save();
    const id = ++job;
    const hands = [];
    for (let i = 0; i < state.n; i++) {
      const [a, b] = state.players[i];
      if (a < 0 || b < 0) { res = { mode: 'none', eq: [], approx: false }; renderResults(); return; }
      hands.push([a, b]);
    }
    const board = boardCards();
    if (board === null) { res = { mode: 'wait', eq: [], approx: false }; renderResults(); return; }

    res = { mode: 'calc', eq: [], approx: false };
    renderResults();

    // 既知ハンド: 常にExact / ランダム相手1人のFlop以降: Exact / それ以外のランダム相手: Monte Carlo(≈)
    let gen, approx = false;
    if (!isRandom()) gen = E.exactGen(hands, board);
    else if (state.opp === 1 && board.length >= 3) gen = E.exactVsRandomGen(hands[0], board);
    else { gen = E.monteCarloVsRandomGen(hands[0], board, state.opp, RANDOM_TRIALS); approx = true; }

    // 約12msずつに分けて実行し、UIを止めない。入力が変わったら前の計算は打ち切る
    (function step() {
      if (id !== job) return;
      const end = performance.now() + 12;
      do {
        const r = gen.next();
        if (r.done) { res = { mode: 'done', eq: r.value.equity, approx }; renderResults(); return; }
      } while (performance.now() < end);
      setTimeout(step, 0);
    })();
  }

  /* ---------- イベント ---------- */
  function onSlotClick(e) {
    const b = e.target.closest('.slot');
    if (!b) return;
    state.active = b.dataset.t === 'p'
      ? { t: 'p', i: +b.dataset.i, j: +b.dataset.j }
      : { t: 'b', j: +b.dataset.j };
    state.open = true;
    render();
  }
  $('players').addEventListener('click', onSlotClick);
  $('board').addEventListener('click', onSlotClick);

  $('mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
  const stepBy = (d) => (isRandom() ? setOpp(state.opp + d) : setCount(state.n + d));
  $('dec').addEventListener('click', () => stepBy(-1));
  $('inc').addEventListener('click', () => stepBy(1));

  $('grid').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled) pick(+b.dataset.c);
  });
  // ‹ ›: カードは変えずに、入力する枠だけ前後に移す(端は反対側につながる)
  const moveActive = (d) => {
    const list = slots();
    const k = list.findIndex((s) => same(s, state.active));
    state.active = list[(k + d + list.length) % list.length];
    render();
  };
  $('prev').addEventListener('click', () => moveActive(-1));
  $('next').addEventListener('click', () => moveActive(1));
  $('clear').addEventListener('click', () => { set(state.active, -1); render(); recompute(); });
  $('close').addEventListener('click', () => { state.open = false; render(); });
  $('open').addEventListener('click', () => {
    state.open = true;
    const list = slots();
    if (get(state.active) >= 0) { const e = list.find((s) => get(s) < 0); if (e) state.active = e; }
    render();
  });
  $('reset').addEventListener('click', () => {
    state.players = [[-1, -1], [-1, -1], [-1, -1], [-1, -1]];
    state.board = [-1, -1, -1, -1, -1];
    state.active = { t: 'p', i: 0, j: 0 };
    render();
    recompute();
  });

  $('copy').addEventListener('click', async () => {
    const url = location.href;
    try { await navigator.clipboard.writeText(url); }
    catch (e) { window.prompt('このURLをコピーしてください', url); return; }
    const b = $('copy');
    b.textContent = 'コピーしました';
    setTimeout(() => { b.textContent = 'リンクをコピー'; }, 1500);
  });
  // 別のURLに書き換えられた(同じタブで貼り付けなど)ときも反映する
  window.addEventListener('hashchange', () => {
    const d = decode(location.hash);
    if (!d) return;
    apply(d);
    render();
    recompute();
  });

  /* ヘルプ / 開発者向け検証(ヘルプの奥。初めて開いたときだけ verify.js を読み込む) */
  $('helpBtn').addEventListener('click', () => { $('help').hidden = false; });
  $('helpClose').addEventListener('click', () => { $('help').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('help').hidden = true; });
  let verifyLoaded = false;
  $('dev').addEventListener('toggle', () => {
    if ($('dev').open && !verifyLoaded) {
      verifyLoaded = true;
      const sc = document.createElement('script');
      sc.src = 'verify.js';
      document.body.appendChild(sc);
    }
  });

  load();
  buildGrid();
  ensureActive();
  render();
  recompute();
})();

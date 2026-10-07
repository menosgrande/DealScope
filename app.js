/* app.js — 入力UI / カード状態 / 結果表示 */
(function () {
  'use strict';
  const E = window.PokerEq;
  const S = window.DealState; // state.js: URL・重複整理・保存データの検証 (純関数)
  const C = window.DealCache; // cache.js: Canonical Key単位のExact結果Cache
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'card-equity-state-v1';
  const RANDOM_TRIALS = 100000; // 相手想定(近似)の試行回数
  const HAND_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];

  /* ---------- カード状態 ----------
   * mode    : 'known'(ハンド指定) | 'random'(相手想定)。人数 n とは独立に持つ
   * n       : ハンド指定の人数(2〜4)。相手想定モードの間も保持する
   * opp     : 相手想定モードの相手の人数(1〜4)
   * players : P1〜P4。相手想定モードの Hero = players[0] (ハンド指定の P1 と共有)。
   *           相手想定モード中も players[1〜n-1] は画面に出さずに保持する (ハンド指定に戻すと復活)
   * board   : 両モード共通
   */
  const state = {
    mode: 'known',
    n: 2,
    opp: 1,
    players: S.emptyHands(),
    board: S.emptyBoard(), // [0..2]=Flop, [3]=Turn, [4]=River
    active: { t: 'p', i: 0, j: 0 },
    open: false,
    deleteTarget: null,
  };

  const isRandom = () => state.mode === 'random';
  const count = () => (isRandom() ? 1 : state.n); // 画面に出ているプレイヤー数
  const pname = (i) => (isRandom() ? 'Hero' : 'Player ' + (i + 1));
  const displayPname = (i) => (!isRandom() && count() === 4) ? 'P' + (i + 1) : pname(i);
  const snapshot = () => ({ mode: state.mode, n: state.n, opp: state.opp, players: state.players, board: state.board });

  function slots() {
    const a = [];
    for (let i = 0; i < count(); i++) { a.push({ t: 'p', i, j: 0 }); a.push({ t: 'p', i, j: 1 }); }
    for (let j = 0; j < 5; j++) a.push({ t: 'b', j });
    return a;
  }
  const get = (s) => (s.t === 'p' ? state.players[s.i][s.j] : state.board[s.j]);
  function slotEnabled(s) {
    if (s.t !== 'b') return true;
    if (s.j < 3) return true;
    const flop = state.board.slice(0, 3).every((c) => c >= 0);
    if (s.j === 3) return flop;
    return flop && state.board[3] >= 0;
  }
  const nextEmptySlot = (start, dir = 1) => {
    const list = slots();
    const k = list.findIndex((s) => same(s, start));
    for (let d = 1; d <= list.length; d++) {
      const s = list[(k + dir * d + list.length * 2) % list.length];
      if (slotEnabled(s) && get(s) < 0) return s;
    }
    return null;
  };
  function set(s, v) { if (s.t === 'p') state.players[s.i][s.j] = v; else state.board[s.j] = v; }
  const same = (a, b) => a.t === b.t && a.i === b.i && a.j === b.j;

  // ピッカーで選べなくするカード = 画面に出ている枠のカードだけ。
  // (隠れているP2〜P4は含めない: 見えないカードのせいで選べない、という分かりにくさを避ける。
  //  重複は、ハンド指定に戻すときに setMode() が整理する)
  function usedCards() {
    const u = new Set();
    slots().forEach((s) => { const c = get(s); if (c >= 0) u.add(c); });
    return u;
  }
  function advance() {
    const s = nextEmptySlot(state.active, 1);
    if (s) { state.active = s; state.deleteTarget = null; return true; }
    return false;
  }
  const activeValid = () => slots().some((s) => same(s, state.active));
  function ensureActive() {
    if (activeValid() && slotEnabled(state.active)) return;
    const list = slots();
    state.active = list.find((s) => slotEnabled(s) && get(s) < 0) ||
      list.find((s) => slotEnabled(s)) || list[0];
  }
  /* 人数・モード変更で入力中の枠が無くなったら、ピッカーを閉じて入力位置をプレイヤー側に戻す。
     (ボードへ勝手に移って、次のカードがボードに入るのを防ぐ) */
  function afterShrink() {
    if (activeValid()) return;
    state.open = false;
    const list = slots();
    state.active = list.find((s) => s.t === 'p' && slotEnabled(s) && get(s) < 0) ||
      list.find((s) => slotEnabled(s) && get(s) < 0) || list[0];
  }
  function pick(c) {
    set(state.active, c);
    if (!advance()) state.open = false;
    render();
    recompute();
  }

  /* 人数変更は「表示人数」の変更であり、隠れたP3/P4の入力は保持する。
     表示中のカードと隠れたカードが重複した場合だけ、dedupe() で後ろ側を空欄に整理する。 */
  function setCount(v) {
    if (isRandom() || v < 2 || v > 4 || v === state.n) return;
    state.n = v;
    const c = S.dedupe(state.board, state.players);
    state.board = c.board;
    state.players = c.players;
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
    if ((m !== 'known' && m !== 'random') || m === state.mode) return;
    state.mode = m;
    if (m === 'known') {
      // 隠れていた P2〜 が戻る。Board と Hero(P1) は画面に出ていたので優先し、重複した側(P2〜)を空欄にする
      const c = S.dedupe(state.board, state.players);
      state.board = c.board;
      state.players = c.players;
    }
    afterShrink();
    render();
    recompute();
  }

  /* ---------- URL / 保存 ----------
   * URLには「いま表示しているモード」の入力だけを入れる (形式は state.js)。
   * 端末(localStorage)には、隠れているP2〜P4も含めて全部保存する。
   */
  function adopt(d) {
    const c = S.dedupe(d.board, d.players); // n 人より後ろ(隠れている)のカードも保持。重複だけ整理
    state.mode = d.mode;
    state.n = d.n;
    state.opp = d.opp >= 1 && d.opp <= 4 ? d.opp : 1;
    state.players = c.players;
    state.board = c.board;
    state.active = { t: 'p', i: 0, j: 0 };
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); } catch (e) { /* 保存できなくても動く */ }
    try { history.replaceState(null, '', S.encode(snapshot()) || location.pathname + location.search); } catch (e) { /* 無視 */ }
  }
  function readSaved() {
    try { return S.normalizeSaved(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { return null; }
  }
  /* 起動時の復元
     ・URLがあれば、URLの内容(= 表示していたモードの入力)を使う
     ・そのURLが「この端末が最後に保存した状態」のURLと同じなら、自分のリロードなので、
       隠れているP2〜P4も端末の保存から戻す。別のURL(他人のリンクなど)なら、隠れた入力は持ち込まない
     ・URLが無い/不正なら、端末の保存から復元 */
  function load() {
    const saved = readSaved();
    const h = location.hash;
    const fromUrl = h.length > 1 ? S.decode(h) : null;
    if (fromUrl) { adopt(saved && S.encode(saved) === h ? saved : fromUrl); return; }
    if (saved) adopt(saved);
  }

  /* ---------- 光るカード (今いちばん強いハンドを作る5枚) ---------- */
  let glow = new Set();
  function computeGlow() {
    glow = new Set();
    const board = boardCards();
    if (!board || board.length < 3) return;
    const made = [];
    for (let i = 0; i < count(); i++) {
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
    const isCur = same(s, state.active) && state.open;
    const act = isCur ? ' active' : '';
    const mark = isCur ? '<span class="cursorMark" aria-hidden="true">▼</span>' : '';
    const delVisible = state.deleteTarget && same(s, state.deleteTarget);
    const attr = `data-t="${s.t}" data-i="${s.i === undefined ? '' : s.i}" data-j="${s.j}"`;
    if (c < 0) {
      // Flopがそろう前のTurn、Turnの前のRiver = まだ入力できない枠(薄く表示してタップしても動かない)
      const locked = !slotEnabled(s);
      return `<span class="cardWrap"><button class="slot empty${act}${locked ? ' locked' : ''}" ${attr}${locked ? ' aria-disabled="true"' : ''} aria-label="未入力"></button>${mark}</span>`;
    }
    const g = glow.size ? (glow.has(c) ? ' hit' : ' off') : '';
    return `<span class="cardWrap">` +
      `<button class="slot filled s${c & 3}${g}${act}" ${attr}>${E.RANKS[c >> 2]}<small>${E.SUITS[c & 3]}</small></button>` +
      `<button class="cardDelete${delVisible ? ' visible' : ''}" data-t="${s.t}" data-i="${s.i === undefined ? '' : s.i}" data-j="${s.j}" aria-label="${slotLabel(s)}を外す">×</button>` +
      mark +
      `</span>`;
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

    $('mode').querySelectorAll('button').forEach((b) => {
      const on = b.dataset.m === state.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('nlabel').textContent = isRandom() ? '相手 ' : '';
    $('nval').textContent = isRandom() ? state.opp : state.n;
    $('dec').disabled = isRandom() ? state.opp <= 1 : state.n <= 2;
    $('inc').disabled = isRandom() ? state.opp >= 4 : state.n >= 4;

    let ph = '';
    ph += '<div class="row handRow"><div class="name">Hand</div><div class="handMain">';
    ph += '<div class="handTools" role="group" aria-label="Handの操作">';
    ph += '<button id="deal" class="boardShuffle" title="空いている枠をランダムなカードで埋める" aria-label="空いている枠をランダムなカードで埋める"><span aria-hidden="true">&#8635;</span><span class="boardShuffleText">配る</span></button>';
    ph += '<button id="handShuffle" class="boardShuffle" title="表示中のHand全体を引き直す" aria-label="表示中のHand全体を引き直す"><span aria-hidden="true">↻</span><span class="handActionText">全体</span></button>';
    ph += '<button id="reset" class="boardClear" title="表示中のHandをすべて消す" aria-label="表示中のHandをすべて消す"><span aria-hidden="true">&times;</span><span class="handActionText">全消去</span></button>';
    ph += '</div>';
    if (isRandom()) {
      ph += '<div class="randomHand">';
      for (let i = 0; i < count(); i++) {
        ph += `<div class="randomHandRow"><div class="randomHandName">${pname(i)}</div><div class="slots">${slotHTML({ t: 'p', i, j: 0 })}${slotHTML({ t: 'p', i, j: 1 })}</div><span class="playerTools"><button class="playerAction playerShuffle" data-player="${i}" data-action="shuffle" aria-label="${pname(i)}のハンドを引き直す" title="${pname(i)}だけ引き直す">↻</button><button class="playerAction playerClear" data-player="${i}" data-action="clear" aria-label="${pname(i)}のハンドを消去" title="${pname(i)}だけ消去">×</button></span><div class="pr" data-i="${i}"></div></div>`;
      }
      ph += '</div>';
    } else {
      ph += `<div class="playerGrid p${count()}" style="--players:${count()}" aria-label="プレイヤー">`;
      for (let i = 0; i < count(); i++) {
        ph += `<div class="pcol p${i}">
          <div class="pheadname"><span class="pdot" aria-hidden="true">●</span><span>${displayPname(i)}</span></div>
          <div class="playerCardsRow"><div class="slots">${slotHTML({ t: 'p', i, j: 0 })}${slotHTML({ t: 'p', i, j: 1 })}</div><span class="playerTools"><button class="playerAction playerShuffle" data-player="${i}" data-action="shuffle" aria-label="${pname(i)}のハンドを引き直す" title="${pname(i)}だけ引き直す">↻</button><button class="playerAction playerClear" data-player="${i}" data-action="clear" aria-label="${pname(i)}のハンドを消去" title="${pname(i)}だけ消去">×</button></span></div>
          <div class="pr" data-i="${i}"></div>
        </div>`;
      }
      ph += `</div><div id="equityBar"></div>`;
    }
    ph += '</div></div>';
    $('players').innerHTML = ph;

    const streetReady = (street) => street === 0 || (street === 1 ? state.board.slice(0, 3).every((c) => c >= 0) : state.board.slice(0, 3).every((c) => c >= 0) && state.board[3] >= 0);
    const streetClearable = (street) => street === 0 ? state.board.some((c) => c >= 0) : street === 1 ? state.board[3] >= 0 || state.board[4] >= 0 : state.board[4] >= 0;
    const grp = (label, street, js) =>
      `<div class="grp${street === 0 ? " flopGrp" : ""}"><div class="grpCards"><div class="slots">${js.map((j) => slotHTML({ t: 'b', j })).join('')}</div><span class="streetTools"><button class="streetShuffle" data-street="${street}" aria-label="${label}を引き直す" title="${label}だけを引き直す"${streetReady(street) ? '' : ' disabled'}>↻</button><button class="streetClear" data-street="${street}" aria-label="${label}を消去" title="${label}以降を消去"${streetClearable(street) ? '' : ' disabled'}>×</button></span></div><div class="cap">${label}</div></div>`;
    $('board').innerHTML = `<div class="row boardRow"><div class="name">Board</div><div class="boardMain"><div class="boardTools"><button id="boardShuffle" class="boardShuffle" aria-label="ボード全体をランダムに引き直す" title="ボード全体をランダムに引き直す"><span aria-hidden="true">↻</span><span class="boardShuffleText">全体</span></button><button id="boardClear" class="boardClear" aria-label="ボードをすべて消去" title="ボードをすべて消去"><span aria-hidden="true">×</span><span class="boardClearText">全消去</span></button></div><div class="bslots">${grp('Flop', 0, [0, 1, 2])}${grp('Turn', 1, [3])}${grp('River', 2, [4])}</div></div></div>`;

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
    for (let i = 0; i < count(); i++) {
      let txt = '—', w = 0;
      if (res.mode === 'calc') txt = '…';
      const done = res.mode === 'done' && res.eq[i] !== undefined; // 人数変更の直後は古い結果を使わない
      if (done) { txt = (res.approx ? '≈' : '') + res.eq[i].toFixed(1) + '%'; w = res.eq[i]; }
      const cell = $('players').querySelector(`.pr[data-i="${i}"]`);
      if (cell) {
        const k = madeHand(i);
        const mh = k < 0 ? '—' : HAND_NAMES[k].replace('ストレートフラッシュ', 'ストレート<br>フラッシュ');
        if (isRandom()) {
          cell.innerHTML = `<div class="pline"><span class="mh">${mh}</span><span class="pct${done ? '' : ' dim'}">${txt}</span></div>` +
            `<div class="bar"><i style="width:${w}%"></i></div>`;
        } else {
          cell.innerHTML = `<div class="pline"><span class="pct${done ? '' : ' dim'}">${txt}</span><span class="mh">${mh}</span></div>`;
        }
      }
    }
    const equityBar = $('equityBar');
    if (equityBar) {
      if (res.mode !== 'done' || res.eq.length !== count()) {
        equityBar.innerHTML = '';
      } else {
        const segs = res.eq.map((v, i) =>
          `<span class="eqseg p${i}bar" style="width:${Math.max(0, v)}%" aria-hidden="true"></span>`
        ).join('');
        const label = res.eq.map((v, i) => `P${i + 1} ${v.toFixed(1)}%`).join(', ');
        const legend = res.eq.map((v, i) =>
          `<span class="p${i}bar"><b>P${i + 1}</b> ${v.toFixed(1)}%</span>`
        ).join('');
        equityBar.innerHTML =
          `<div class="eqbarWrap"><div class="eqbar" role="img" aria-label="勝率の合計100%。${label}">${segs}</div><div class="eqlegend">${legend}</div></div>`;
      }
    }
    let h = '';
    if (isRandom()) h += `<div class="note">vs ランダム${state.opp}人${res.mode === 'done' && res.approx ? '(近似値)' : ''}</div>`;
    if (res.mode === 'wait') h += '<div class="note">入力待ち — ボードはFlopの3枚がそろうと計算します</div>';
    $('results').innerHTML = h;
    renderCats();
  }

  /* 勝率の左に出す「いま作れている役」。Flop以降で、そのプレイヤーの2枚がそろっているときだけ(それ以外は -1 = 「—」) */
  function madeHand(i) {
    const board = boardCards();
    if (!board || board.length < 3) return -1;
    const [a, b] = state.players[i];
    if (a < 0 || b < 0) return -1;
    return E.evaluate(board.concat([a, b])) >> 20;
  }

  /* ---------- 最終役 ----------
   * 役 × プレイヤーの2つの指標を切り替えて表示する。
   * equity: 各ランアウトで得たequityを最終役へ割り当てた「勝率の内訳」。
   * rate: 最終役の出現率で、各プレイヤーの列合計は100%。
   */
  let catsOpen = false;
  let catMetric = 'equity';
  $('cats').addEventListener('toggle', (e) => { if (e.target.id === 'catsBox') catsOpen = e.target.open; }, true);
  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-catmetric]');
    if (!b) return;
    catMetric = b.dataset.catmetric === 'rate' ? 'rate' : 'equity';
    renderCats();
  });

  const fmtCat = (v) => (v === 0 ? '–' : (v < 0.05 ? '<0.1' : v.toFixed(1)) + '%');

  function renderCats() {
    const box = $('cats');
    if (res.mode === 'none' || res.mode === 'wait') { box.innerHTML = ''; return; }
    const open = catsOpen ? ' open' : '';
    if (res.mode === 'calc') {
      box.innerHTML = catsOpen
        ? `<details id="catsBox" class="cats"${open}><summary>最終役</summary><div class="catTabs" role="tablist" aria-label="最終役の指標"><button role="tab" aria-selected="${catMetric === 'equity'}" class="${catMetric === 'equity' ? 'on' : ''}">勝率の内訳</button><button role="tab" aria-selected="${catMetric === 'rate'}" class="${catMetric === 'rate' ? 'on' : ''}">成立率</button></div><p class="note">計算中…</p></details>`
        : '<details id="catsBox" class="cats"><summary>最終役</summary></details>';
      return;
    }
    if (!res.cats || !res.catEquity || res.rand !== isRandom() ||
        res.cats.length !== (isRandom() ? 2 : count()) ||
        res.catEquity.length !== (isRandom() ? 2 : count())) { box.innerHTML = ''; return; }

    const data = catMetric === 'equity' ? res.catEquity : res.cats;
    const heads = isRandom() ? ['Hero', '相手'] : data.map((_, i) => 'P' + (i + 1));
    const maxOf = data.map((col) => Math.max(...col));
    let t = '<table class="ctbl"><thead><tr><th></th>' + heads.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
    for (let k = 0; k < 9; k++) {
      t += `<tr><th scope="row">${HAND_NAMES[k]}</th>` + data.map((col, p) => {
        const cls = col[k] === 0 ? ' class="z"' : (col[k] === maxOf[p] ? ' class="catTop"' : '');
        return `<td${cls}>${fmtCat(col[k])}</td>`;
      }).join('') + '</tr>';
    }
    const totals = data.map((col) => col.reduce((a, b) => a + b, 0));
    t += '<tr class="catTotal"><th scope="row">合計</th>' + totals.map((v) => `<td>${v.toFixed(1)}%</td>`).join('') + '</tr>';
    t += '</tbody></table>';

    let note;
    if (catMetric === 'equity') {
      note = '各ランアウトで得たequityを、そのランアウトの最終役へ割り当てた割合です。';
      note += ' 各列の合計は、そのプレイヤーの勝率(equity)です。';
    } else {
      note = '全パターンのうち、最終的にその役になる割合です。各列の合計は100%です。';
    }
    if (isRandom() && res.opp > 1) note += ' 相手は1人あたりの割合です。';
    if (res.approx) note += ' 近似値(ランダムに配った10万回の集計)です。';
    const tabs = `<div class="catTabs" role="tablist" aria-label="最終役の指標"><button type="button" role="tab" aria-selected="${catMetric === 'equity'}" class="${catMetric === 'equity' ? 'on' : ''}" data-catmetric="equity">勝率の内訳</button><button type="button" role="tab" aria-selected="${catMetric === 'rate'}" class="${catMetric === 'rate' ? 'on' : ''}" data-catmetric="rate">成立率</button></div>`;
    box.innerHTML = `<details id="catsBox" class="cats"${open}><summary>最終役</summary>${tabs}${t}<p class="note">${note}</p></details>`;
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
    hideToast(); // 何か変わったら「元に戻す」は出し続けない(古い状態で上書きしてしまうため)
    save();
    const id = ++job;
    const hands = [];
    for (let i = 0; i < count(); i++) {
      const [a, b] = state.players[i];
      if (a < 0 || b < 0) { res = { mode: 'none', eq: [], approx: false }; renderResults(); return; }
      hands.push([a, b]);
    }
    const board = boardCards();
    if (board === null) { res = { mode: 'wait', eq: [], approx: false }; renderResults(); return; }

    res = { mode: 'calc', eq: [], approx: false };
    renderResults();

    // ハンド指定: 常にExact / 相手想定1人のFlop以降: Exact / それ以外の相手想定: Monte Carlo(≈)
    const rand = isRandom(), opp = state.opp;
    let gen, approx = false;
    const exact = !rand || (opp === 1 && board.length >= 3);
    let cacheKey = null;
    // ExactだけCanonical Keyに接続する。Monte Carloは乱数性を維持するためCacheしない。
    if (exact) {
      const canonical = S.buildCanonicalState({
        players: hands,
        board,
        deadCards: [],
        calculationMode: 'exact',
        opponentCount: rand ? opp : null,
      });
      cacheKey = S.canonicalKey(canonical);
      const cached = C.get(cacheKey);
      if (cached) {
        res = { mode: 'done', eq: cached.equity, cats: cached.cats, catEquity: cached.catEquity, approx: false, rand, opp };
        renderResults();
        return;
      }
    }
    if (!rand) gen = E.exactGen(hands, board);
    else if (opp === 1 && board.length >= 3) gen = E.exactVsRandomGen(hands[0], board);
    else { gen = E.monteCarloVsRandomGen(hands[0], board, opp, RANDOM_TRIALS); approx = true; }

    // 約12msずつに分けて実行し、UIを止めない。入力が変わったら前の計算は打ち切る
    (function step() {
      if (id !== job) return;
      const end = performance.now() + 12;
      do {
        const r = gen.next();
        if (r.done) {
          if (cacheKey && !approx) C.set(cacheKey, r.value);
          res = { mode: 'done', eq: r.value.equity, cats: r.value.cats, catEquity: r.value.catEquity, approx, rand, opp };
          renderResults();
          return;
        }
      } while (performance.now() < end);
      setTimeout(step, 0);
    })();
  }

  /* ---------- イベント ---------- */
  function onSlotClick(e) {
    const del = e.target.closest('.cardDelete');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      const s = del.dataset.t === 'p'
        ? { t: 'p', i: +del.dataset.i, j: +del.dataset.j }
        : { t: 'b', j: +del.dataset.j };
      set(s, -1);
      state.active = s;
      state.deleteTarget = null;
      state.open = true;
      render();
      recompute();
      return;
    }
    const b = e.target.closest('.slot');
    if (!b) return;
    const target = b.dataset.t === 'p'
      ? { t: 'p', i: +b.dataset.i, j: +b.dataset.j }
      : { t: 'b', j: +b.dataset.j };
    if (get(target) < 0 && !slotEnabled(target)) return; // まだ入力できない枠
    state.active = target;
    state.deleteTarget = get(state.active) >= 0 ? state.active : null;
    state.open = true;
    render();
  }
  $('players').addEventListener('click', onSlotClick);
  $('board').addEventListener('click', onSlotClick);
  // ピッカーの外側をクリック／タップしたら閉じる。
  // pointerdown を使うことで、枠をタップした場合はその後の slot click で自然に再オープンできる。
  document.addEventListener('pointerdown', (e) => {
    if (!state.open) return;
    const picker = $('picker');
    const openButton = $('open');
    if (picker.contains(e.target) || openButton.contains(e.target)) return;
    state.open = false;
    state.deleteTarget = null;
    render();
  });
  // ボード全体 / ストリート単位の引き直し・消去。Boardコンテナはrender()で作り直されるためイベント委譲する。
  let streetShuffleExplained = false;
  $('board').addEventListener('click', (e) => {
    const shuffle = e.target.closest('#boardShuffle, .streetShuffle');
    const clear = e.target.closest('#boardClear, .streetClear');
    if (shuffle && !shuffle.disabled) {
      e.preventDefault();
      const street = shuffle.classList.contains('streetShuffle') ? +shuffle.dataset.street : null;
      const prev = { players: state.players.map((h) => h.slice()), board: state.board.slice() };
      const r = street === null
        ? S.shuffleBoard(state.players, state.board, Math.random)
        : S.shuffleBoardStreet(state.players, state.board, street, Math.random);
      state.players = r.players;
      state.board = r.board;
      state.deleteTarget = null;
      state.open = false;
      render();
      recompute();
      undo = prev;
      $('toastMsg').textContent = street === null
        ? 'ボード全体を引き直しました'
        : (street === 0
          ? (streetShuffleExplained ? 'Flopを引き直しました' : 'Flopだけ引き直しました。Turn・Riverはそのままです')
          : street === 1
            ? (streetShuffleExplained ? 'Turnを引き直しました' : 'Turnだけ引き直しました。Riverはそのままです')
            : (streetShuffleExplained ? 'Riverを引き直しました' : 'Riverだけ引き直しました'));
      if (street !== null) streetShuffleExplained = true;
      $('toast').hidden = false;
      toastTimer = setTimeout(hideToast, 7000);
      return;
    }
    if (clear && !clear.disabled) {
      e.preventDefault();
      const street = clear.classList.contains('streetClear') ? +clear.dataset.street : null;
      const prev = { players: state.players.map((h) => h.slice()), board: state.board.slice() };
      if (street === null) {
        if (!state.board.some((c) => c >= 0)) return;
        state.board = S.clearBoard(state.players, state.board).board;
      } else {
        if (!state.board.some((c) => c >= 0)) return;
        state.board = S.clearBoardStreet(state.players, state.board, street).board;
      }
      state.deleteTarget = null;
      state.open = false;
      render();
      recompute();
      undo = prev;
      $('toastMsg').textContent = street === null
        ? 'ボードをすべて消しました'
        : (street === 0 ? 'Flopと、それ以降のボードを消しました' : street === 1 ? 'TurnとRiverを消しました' : 'Riverを消しました');
      $('toast').hidden = false;
      toastTimer = setTimeout(hideToast, 7000);
    }
  });

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
    for (let step = 1; step <= list.length; step++) {
      const s = list[(k + d * step + list.length * 2) % list.length];
      if (slotEnabled(s)) { state.active = s; break; }
    }
    render();
  };
  $('prev').addEventListener('click', () => moveActive(-1));
  $('next').addEventListener('click', () => moveActive(1));
  $('clear').addEventListener('click', () => { set(state.active, -1); render(); recompute(); });
  $('close').addEventListener('click', () => { state.open = false; render(); });
  $('open').addEventListener('click', () => {
    state.open = true;
    const list = slots();
    if (!slotEnabled(state.active) || get(state.active) >= 0) {
      const e = list.find((s) => slotEnabled(s) && get(s) < 0);
      if (e) state.active = e;
    }
    render();
  });
  // Hand操作。playersコンテナ側でイベント委譲する。各操作は対象だけを変更し、Undoで元に戻せる。
  let undo = null, toastTimer = 0;
  function hideToast() { clearTimeout(toastTimer); undo = null; $('toast').hidden = true; }
  function showUndo(prev, message) {
    undo = prev;
    $('toastMsg').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(hideToast, 7000);
  }
  function dealCards() {
    const r = S.fillEmpty(state.players, state.board, count(), Math.random);
    state.players = r.players;
    state.board = r.board;
    if (!slots().some((s) => get(s) < 0)) state.open = false;
    render();
    recompute();
  }
  function shuffleHandCards(playerIndex) {
    const prev = { players: state.players.map((h) => h.slice()), board: state.board.slice() };
    const r = S.shufflePlayerHand(state.players, state.board, playerIndex, Math.random);
    state.players = r.players;
    state.board = r.board;
    state.deleteTarget = null;
    state.open = false;
    render();
    recompute();
    showUndo(prev, pname(playerIndex) + 'のハンドを引き直しました');
  }
  function shuffleAllHandCards() {
    const prev = { players: state.players.map((h) => h.slice()), board: state.board.slice() };
    const r = S.shuffleHands(state.players, state.board, count(), Math.random);
    state.players = r.players;
    state.board = r.board;
    state.deleteTarget = null;
    state.open = false;
    render();
    recompute();
    showUndo(prev, 'Hand全体を引き直しました');
  }
  function clearHandCards(playerIndex) {
    if (state.players[playerIndex].every((c) => c < 0)) return;
    const prev = { players: state.players.map((h) => h.slice()), board: state.board.slice() };
    state.players = S.clearPlayerHand(state.players, playerIndex).players;
    state.deleteTarget = null;
    state.open = false;
    render();
    recompute();
    showUndo(prev, pname(playerIndex) + 'のハンドを消去しました');
  }
  function clearAllHandCards() {
    const shown = count();
    if (!state.players.slice(0, shown).some((h) => h.some((c) => c >= 0))) return;
    const prev = { players: state.players.map((h) => h.slice()), board: state.board.slice() };
    state.players = S.clearHands(state.players, shown).players;
    state.active = { t: 'p', i: 0, j: 0 };
    state.deleteTarget = null;
    state.open = false;
    render();
    recompute();
    showUndo(prev, 'Handをすべて消しました');
  }

  $('players').addEventListener('click', (e) => {
    const deal = e.target.closest('#deal');
    if (deal) { e.preventDefault(); dealCards(); return; }
    const allShuffle = e.target.closest('#handShuffle');
    if (allShuffle) { e.preventDefault(); shuffleAllHandCards(); return; }
    const allClear = e.target.closest('#reset');
    if (allClear) { e.preventDefault(); clearAllHandCards(); return; }
    const playerAction = e.target.closest('.playerAction');
    if (playerAction) {
      e.preventDefault();
      const i = +playerAction.dataset.player;
      if (playerAction.dataset.action === 'shuffle') shuffleHandCards(i);
      else if (playerAction.dataset.action === 'clear') clearHandCards(i);
    }
  });
  $('toastUndo').addEventListener('click', () => {
    if (!undo) return;
    state.players = undo.players;
    state.board = undo.board;
    render();
    recompute(); // ここで hideToast() も呼ばれる
  });

  $('copy').addEventListener('click', async () => {
    const url = location.href;
    try { await navigator.clipboard.writeText(url); }
    catch (e) { window.prompt('このURLをコピーしてください', url); return; }
    const b = $('copy');
    b.textContent = 'コピーしました';
    setTimeout(() => { b.textContent = 'リンクをコピー'; }, 1500);
  });
  // 別のURLに書き換えられた(同じタブで貼り付けなど)ときも反映する。
  // URLに入っているのは表示中のモードの入力だけなので、隠れていたP2〜P4は持ち込まない
  window.addEventListener('hashchange', () => {
    const d = S.decode(location.hash);
    if (!d) return;
    adopt(d);
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

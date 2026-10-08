(function(root){'use strict';
const V=root.DealVerify;const {E,out,tick,pct,pl,num,head,row,summary,setBusy,card,cards}=V;
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
  
    /* ---------- Canonical State / Key ---------- */
    async function testCanonicalState() {
      const S = window.DealState;
      const a = {
        players: [['Ah', 'Ad'].map(card), ['Ks', 'Kd'].map(card)],
        board: cards('Qc Jc 2h'),
        deadCards: [],
        calculationMode: 'exact',
        opponentCount: null,
      };
      const b = {
        players: [['Ad', 'Ah'].map(card), ['Kd', 'Ks'].map(card)],
        board: cards('2h Qc Jc'),
        deadCards: [],
        calculationMode: 'exact',
        opponentCount: null,
      };
      const ka = S.canonicalKey(S.buildCanonicalState(a));
      const kb = S.canonicalKey(S.buildCanonicalState(b));
      const swapped = { ...a, players: [a.players[1], a.players[0]] };
      const differentHand = { ...a, players: [a.players[0], ['Qs', 'Qd'].map(card)] };
      const differentStreet = { ...a, board: cards('Qc Js 2h 9d') };
      const dead = { ...a, deadCards: cards('Ac') };
      const differentMode = { ...a, calculationMode: 'monteCarlo', opponentCount: 1 };
      const checks = [
        ['hole card order is normalized', ka === kb],
        ['board order is normalized', ka === kb],
        ['player order is preserved', ka !== S.canonicalKey(S.buildCanonicalState(swapped))],
        ['different hole cards are different', ka !== S.canonicalKey(S.buildCanonicalState(differentHand))],
        ['different street is different', ka !== S.canonicalKey(S.buildCanonicalState(differentStreet))],
        ['known dead card is represented', ka !== S.canonicalKey(S.buildCanonicalState(dead))],
        ['calculation mode is represented', ka !== S.canonicalKey(S.buildCanonicalState(differentMode))],
      ];
      const ok = checks.every((x) => x[1]);
      row(ok ? 'ok' : 'ng', 'Canonical State / Key',
        '結果に影響する状態を保持し、表現上の順序差だけを正規化する',
        checks.map((x) => `${x[1] ? '✓' : '✕'} ${x[0]}`).join('\\n'));
      await tick();
      return ok;
    }
Object.assign(V.tests,{testStateHelpers,testCanonicalState});
})(window);

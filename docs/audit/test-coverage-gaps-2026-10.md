# Test and Code Coverage Audit (2026-10-16, revised)

## Scope

Read-only audit of the current `main` versions of:

- `tests/minigame-ev-active.test.cjs`
- `tests/minigame-chip-conservation.test.cjs`
- `ci/verify.js`
- `minigame/ev.js`
- `minigame/pots.js`
- `verify.js`
- `SPEC.md`
- `.github/workflows/verify.yml`

This document separates existing assertions from remaining coverage gaps. A missing assertion is not, by itself, evidence of a runtime defect. The test files were inspected remotely; this audit does not claim that the full suite was executed locally.

## Findings

### P1 — EV boundary coverage exists, but raise legality and responder edge cases remain

The initial version of this audit understated existing coverage. The current `ci/verify.js` already asserts numeric EV results for a short-stack call, an unmatchable excess contribution, a folded contributor, an all-in opponent, and rejection of duplicate known cards. It also checks that multiway aggressive EV rows are suppressed. `tests/minigame-ev-active.test.cjs` separately covers action-row presence, selected raise sizing, and the collapsible UI.

Remaining cases worth adding:

- A proposed raise target above Hero's stack: assert the exact effective target and whether the action is legal or represented as all-in.
- A stack-capped raise that is below the normal minimum raise: assert the short-all-in exception is handled consistently with the game rules.
- No opponent remains eligible to respond (all opponents folded, out, or all-in): assert the available rows and EV status are appropriate.
- Invalid/malformed card IDs, in addition to duplicate known cards, are rejected safely.
- A regression test that compares displayed EV units and pot/call inputs against the documented heuristic formula.

These are coverage improvements, not confirmed calculation defects. Keep the displayed values explicitly labeled as heuristic estimates, not solver EV or action recommendations.

Evidence: `ci/verify.js`, `tests/minigame-ev-active.test.cjs`, and `minigame/ev.js`.

### P1 — Pot settlement has side-pot and odd-chip smoke coverage; exact payout rules still need deeper cases

The current `ci/verify.js` includes an exact per-seat main-pot/side-pot fixture where the strongest short stack wins the main pot and a weaker hand wins the side pot, plus a tied-pot odd-chip fixture that verifies conservation and a one-chip difference. `tests/minigame-chip-conservation.test.cjs` also checks showdown/fold-win conservation and that a folded player does not receive an award. Therefore, the original claim that these cases were untested was too broad.

Remaining cases worth adding:

- Three or more contribution layers with a different winner at each layer.
- Ties within a side pot as well as the main pot, with exact per-seat awards.
- Folded players contributing at multiple levels and all-in players eligible only for lower layers.
- A contribution layer with no eligible non-folded player: define the intended behavior explicitly, then test it.
- Odd-chip assignment relative to the button and first eligible seat clockwise, if standard Hold'em seat-order behavior is intended. Current coverage intentionally avoids assuming button-relative order.
- Property-style small-state tests for conservation and eligibility, alongside hand-verifiable fixed examples.

These are fidelity and coverage questions, not proof that ordinary settlement is incorrect.

Evidence: `ci/verify.js`, `tests/minigame-chip-conservation.test.cjs`, and `minigame/pots.js`.

### P2 — Independent preflop reference value remains missing

`SPEC.md` section 12.6 marks the known-opponent, one-opponent preflop Monte Carlo reference value as not registered. Do not fill this slot with a guessed value. Obtain a reproducible value from an independent trusted calculator and record the source URL, access date, exact cards, board, number of opponents, trial count or exact-calculation mode, and tie/equity convention.

Evidence: `SPEC.md` section 12.6.

### P2 — Responsive smoke coverage exists; visual QA is still incomplete

The initial audit missed the viewport assertions in `ci/browser-verify.html`. The existing CI browser test already checks the calculator and mini-game at 320, 375, 390, and 430 CSS px for horizontal overflow, key controls/cards being clipped, major-region overlap, player-seat overlap, and action-button overlap.

Remaining work is visual rather than a missing baseline assertion: retain or compare screenshots if useful, and perform a manual check of vertical scrolling, tap targets, and real-device rendering. Do not add a duplicate viewport test without first extending the current one.

Evidence: `ci/browser-verify.html`, `ci/browser-verify.js`, and `.github/workflows/verify.yml`.

### P2 — Documentation boundaries need to remain explicit

The intended product boundary is: the core analysis page may display Pot Odds as contextual information, but it does not recommend actions or provide strategy-solving EV. The separate `minigame/` mode may show heuristic action-EV estimates as a game aid; those values are not GTO/Solver outputs or optimal-action recommendations.

The README now states this boundary, describes Monte Carlo error as a statistical estimate rather than a maximum, and marks the existing responsive CI smoke checks as implemented. When revising `SPEC.md`, keep roadmap items clearly marked and distinguish implemented automation from remaining manual visual QA.

Evidence: `README.md`, `SPEC.md`, and `minigame/ev.js`.

## Recommended implementation order

1. Add EV tests for stack-capped raises, minimum-raise exceptions, and no eligible responder states.
2. Expand pure `minigame/pots.js` tests for three-plus contribution layers, side-pot ties, and button-relative odd chips if required by the intended rules.
3. Extend the existing mobile viewport smoke checks only if a specific uncovered regression is identified; otherwise complete manual visual QA.
4. Register an independently sourced preflop reference case with full provenance.
5. Keep README and SPEC aligned with the core-versus-mini-game boundary.

## Audit limitation

This is a source/test-coverage audit, not a full execution or visual QA report. Repository files were inspected remotely. The audit does not claim that the full test suite was run locally or that a production deployment was manually exercised.

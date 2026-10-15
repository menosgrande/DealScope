# Test and Code Coverage Audit (2026-10-16)

## Scope

Read-only audit of the current `main` versions of:

- `tests/minigame-ev-active.test.cjs`
- `tests/minigame-chip-conservation.test.cjs`
- `minigame/ev.js`
- `minigame/pots.js`
- `verify.js`
- `SPEC.md`
- `.github/workflows/verify.yml`

This document records coverage gaps observed in the current tests. It does not claim that the implementation is incorrect where a case is simply untested.

## Findings

### P1 — Mini-game EV boundary behavior is not directly asserted

The EV test checks hand labels, bet-sizing presets, that changing a raise target changes the displayed estimate, fold EV equals zero, and that aggressive EV rows are suppressed in multiway spots. It does not directly assert expected numeric outcomes for these boundaries in `minigame/ev.js`:

- Hero has less chips than the amount to call (short-stack call / effective investment).
- A raise target is capped by Hero's remaining stack and interacts with the minimum legal raise.
- One or more opponents are folded or all-in and therefore cannot respond.
- Opponent contributions exceed Hero's total contribution, so chips in an unmatchable side pot must not be counted as contestable by Hero.
- Known-hand equity input includes duplicate cards or malformed cards.
- No opponent remains eligible to respond.

Recommended follow-up: add deterministic tests for these cases before changing EV formulas. Assert both status/row availability and the numeric EV formula for hand-crafted states. Keep heuristic estimates clearly distinguished from exact poker EV.

Evidence: `tests/minigame-ev-active.test.cjs` and `minigame/ev.js`.

### P1 — Pot settlement tests verify conservation, but only lightly verify award correctness

The chip-conservation test verifies that total chips are conserved, the displayed pot is cleared, total awards equal the pot, and a folded player receives no award in one side-pot fixture. Conservation alone cannot prove that the correct eligible player received each side pot.

Untested settlement cases to add:

- Two or more contribution levels with different winners for the main pot and side pot.
- A tied best hand and odd-chip distribution.
- A player who is all-in at a lower contribution level while deeper stacks continue contributing.
- Folded players at multiple contribution levels.
- A contribution layer with no eligible non-folded player, including the expected handling of any unallocated amount.
- Exact per-seat award totals, not only aggregate award totals.

Recommended follow-up: test `minigame/pots.js` as a pure function with small, hand-verifiable scores and contributions. Assert per-seat awards and conservation independently.

Evidence: `tests/minigame-chip-conservation.test.cjs` and `minigame/pots.js`.

### P2 — Independent preflop reference value remains missing

`SPEC.md` section 12.6 explicitly marks the known-opponent, one-opponent preflop Monte Carlo reference value as not registered. Other listed Monte Carlo checks have comparison targets, but this case does not yet have an external trusted reference.

Recommended follow-up: obtain a reproducible value from a trusted independent calculator, and record source URL, access date, exact cards, board, number of opponents, and tie/equity convention before adding it. Do not fill this slot with a guessed value.

Evidence: `SPEC.md` section 12.6.

### P2 — Mobile visual regression is not currently a CI assertion

The workflow runs Node regression tests, a browser regression script, the analysis-to-mini-game bridge, EV checks, and chip-conservation checks. The browser verification description in `ci/browser-verify.js` focuses on Pot Odds input/calculation/localStorage restoration. No viewport screenshot or overflow assertion was identified in the reviewed CI entry points.

Recommended follow-up: add a separate browser test at representative widths (320, 375, 390, 430 CSS px) to detect horizontal overflow and key control clipping. Treat screenshots as review artifacts, not as a substitute for functional assertions.

Evidence: `.github/workflows/verify.yml` and `ci/browser-verify.js`.

### P2 — Documentation boundaries need a focused synchronization pass

`SPEC.md` roadmap's "対象外" lists Pot Odds and EV as out of scope, while the current README describes Pot Odds as a current analysis detail and the mini-game has a separate heuristic action-EV panel. The product boundary may still be intentional (core analysis vs separate mini-game), but the wording does not make that distinction explicit in the reviewed sections.

Recommended follow-up: clarify that the core DealScope analysis page may show Pot Odds context if that is current behavior, while the separate mini-game EV panel is a heuristic game aid, not a solver or action recommendation. Keep the roadmap labeled as future work and avoid describing implemented behavior as unimplemented.

Evidence: `README.md` information hierarchy; `SPEC.md` section 13; `minigame/ev.js`.

## Recommended implementation order

1. Add pure unit tests for `minigame/pots.js` that assert exact per-seat awards across layered side pots and ties.
2. Add deterministic EV boundary tests for short calls, stack caps, and contestable-pot calculations.
3. Add a mobile viewport smoke test.
4. Register an independently sourced preflop reference case.
5. Synchronize README/SPEC wording after confirming the intended product boundary.

## Audit limitation

This is a source/test-coverage audit, not a full execution or visual QA report. The reviewed repository files were inspected remotely; this audit does not claim that the full test suite was run locally or that a production deployment was manually exercised.

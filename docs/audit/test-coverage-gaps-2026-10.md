# Test and Code Coverage Audit (2026-10-16, revised)

## Scope

Review of the current DealScope main branch, focusing on mini-game EV, pot settlement, CPU action policy, responsive browser checks, and equity verification. Missing coverage is not treated as proof of a runtime defect.

## Findings and closure status

### EV boundaries — additional regression coverage added

Existing checks cover short-stack calls, folded contributors, all-in opponents, duplicate known cards, and suppression of unsupported multiway aggressive-EV rows. New assertions on `main` cover stack-capped raise labeling, short all-in raise boundaries, malformed known cards, and no-responder states. The unused multiway EV function and duplicate render branch were removed rather than left as misleading dead code.

EV values remain heuristic estimates for the separate mini-game, not Solver/GTO outputs or action recommendations.

### Pot settlement — exact edge fixtures added

The pure settlement tests now cover:
- Three contribution layers with a different winner at each level.
- Exact per-seat awards and chip conservation.
- A tied side pot with an odd chip, with priority clockwise from the dealer button.
- A higher contribution layer whose contributors have all folded; that dead layer follows the previous eligible pot winners instead of disappearing or being awarded to folded players.

The settlement function receives the dealer seat from the game. Remaining coverage could include property-based small-state checks, but the previously listed fixed-case gaps have been addressed.

### CPU behavior — deterministic decision-policy sampling added

The current mini-game's private CPU decision function is exercised across all four CPU types, preflop/flop/turn/river, unopened/facing-bet states, and deep/short effective stacks. The test samples legal random card configurations with deterministic seeds and checks that every sample yields a recognized response, that deep-stack states do not produce surprise all-ins, and that facing-bet/unopened states return the appropriate action family.

This is a decision-policy distribution smoke test, not a full tournament simulation. If future CPU tuning changes these thresholds, review the resulting per-stratum counts before changing limits. A full-hand simulation with long-run VPIP, fold-to-raise, all-in, showdown, and average-pot statistics would provide a stronger behavioral model, but should only be added if the current policy smoke test reveals a concrete problem.

### Preflop equity reference — registered with uncertainty

`SPEC.md` section 12.6 records an external approximate reference for Hero `As Ah` against one uniformly random opponent hand: 85.2% equity. The source reports 400,000 simulated runouts and a rounded result, so it is not an exact golden value. The developer verification and CI compare the fixed-seed, 100,000-trial result within a four-standard-error tolerance. Keep the source, access date, trial count, and tie/equity convention explicit.

### Responsive behavior — automated smoke checks cover supported phone widths

`ci/browser-verify.html` checks 320, 375, 390, and 430 CSS px for horizontal overflow, clipped controls/cards, overlapping major regions/seats/action buttons, calculator-to-game state transfer, glossary filtering, and a real mini-game settlement. This is more than a basic viewport check.

Manual real-device inspection cannot be conclusively replaced by headless CI. The remaining human-only question is whether the UI feels comfortable to use while scrolling and tapping on physical phones. The CI can be strengthened with explicit minimum tap-target assertions and retained screenshots, but do not duplicate existing overflow/overlap assertions.

### Documentation — scope and statistical language corrected

The README now describes Monte Carlo error as a statistical estimate rather than a hard maximum and distinguishes implemented responsive checks from remaining manual visual QA. The core calculator remains an objective equity/context tool; the mini-game's action-EV display remains a separate heuristic feature, not a solver.

## Current remaining work

1. Add or retain explicit tap-target-size assertions in the browser smoke test if the current controls meet the chosen threshold; otherwise fix any failing control.
2. Review CPU per-stratum counts from CI and adjust the decision policy only if the deterministic sample shows an unreasonable pattern. A full-hand simulation is optional follow-up, not a blocker absent evidence of a defect.
3. Perform a final real-phone visual/tap check if physical-device access is available; automated CI already covers viewport bounds and functional paths.

## Audit limitation

Source and test files were inspected through repository tools. GitHub Actions is the execution source of truth; do not describe a workflow as passing until its run has completed successfully. This document does not claim a manual real-device test or an exhaustive full-tournament CPU simulation.

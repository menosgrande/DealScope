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

In addition, the test runs 32 complete hands through the real mini-game action/settlement loop with the policy controlling all four seats. The latest deterministic sample reported a 3.1% all-in-hand rate, 84.4% showdown rate, mean pot of 6,344 chips, and 9.9 actions per hand. In 120 sampled deep-stack unopened preflop states per type, open-bet rates were TAG 47.5%, LAG 66.7%, TP 30.8%, and LP 45.0%; the test asserts LAG opens more often than TP. These are regression baselines for the tested seeds and stack/blind setup, not claims about all possible tournaments. If CPU tuning changes, compare these metrics before accepting the change.

### Preflop equity reference — registered with uncertainty

`SPEC.md` section 12.6 records an external approximate reference for Hero `As Ah` against one uniformly random opponent hand: 85.2% equity. The source reports 400,000 simulated runouts and a rounded result, so it is not an exact golden value. The developer verification and CI compare the fixed-seed, 100,000-trial result within a four-standard-error tolerance. Keep the source, access date, trial count, and tie/equity convention explicit.

### Responsive behavior — automated smoke checks cover supported phone widths

`ci/browser-verify.html` checks 320, 375, 390, and 430 CSS px for horizontal overflow, clipped controls/cards, overlapping major regions/seats/action buttons, calculator-to-game state transfer, glossary filtering, and a real mini-game settlement. This is more than a basic viewport check.

The browser smoke test now also uses a 700px phone-like viewport height, verifies the page is vertically scrollable, asserts frequently used controls meet a 24x24 CSS-pixel minimum target size, and scrolls each visible target into the viewport to confirm it is reachable. Manual real-device inspection remains useful for subjective comfort and actual touch feel, but no known automated viewport/tap-target gap remains.

### Documentation — scope and statistical language corrected

The README now describes Monte Carlo error as a statistical estimate rather than a hard maximum and distinguishes implemented responsive checks from remaining manual visual QA. The core calculator remains an objective equity/context tool; the mini-game's action-EV display remains a separate heuristic feature, not a solver.

## Remaining acceptance check

No outstanding code or automated-test task is currently identified by this audit. The only remaining optional acceptance check is a real-phone pass for subjective visual comfort and physical touch feel; it cannot be honestly certified by a headless browser.

## Audit limitation

Source and test files were inspected through repository tools. GitHub Actions is the execution source of truth. The CPU full-hand simulation is a 32-hand deterministic regression sample, not an exhaustive simulation of every tournament configuration. No physical-device test is claimed.

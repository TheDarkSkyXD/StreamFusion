---
name: prove
description: Prove — with real, observed evidence — that a feature is actually implemented and working, rather than just asserting it is. Use this whenever the user wants proof/confirmation that something works: "prove it works", "show me it's done", "verify this feature", "confirm it actually works", "did you really finish X", "test it and show me", or any moment where you're about to claim a feature is complete and need to back that claim with evidence instead of optimism. The default path is driving the real app in a browser via the Playwright MCP and capturing screenshots; for features with no UI, fall back to running the actual code (tests, API calls, CLI). Trigger this proactively before declaring any non-trivial feature "done" — claiming completion without observed evidence is exactly the failure this skill exists to prevent.
---

# Prove It Works

The job here is to *prove*, not to *claim*. The difference matters: "I implemented the login form and it should work" is a claim. "I opened the app, typed valid credentials, clicked Sign in, and here's the screenshot of the dashboard that loaded" is proof. This skill exists because asserting success without observing it is the single most common way work gets handed back broken — so the bar is evidence the user can see, not your confidence.

Adopt an adversarial stance toward your own work. Your goal is not to confirm you succeeded; it's to *try to catch yourself failing*. If you go looking for problems and genuinely can't find any after exercising the feature for real, that's proof. If you only look for confirmation, you'll find it whether or not the feature works — which is worthless.

## The core loop

1. **Pin down the claim.** State precisely what "working" means for this feature — the specific user-visible behavior(s) that must hold. Vague claims can't be proven. If the feature has several behaviors (happy path, validation, error states), list them; you'll need evidence for each that matters.

2. **Re-read your own implementation.** Before touching the running app, look at the code you wrote with fresh, skeptical eyes. Trace the actual path the feature takes. Look for the things that compile fine but break at runtime: a handler wired to the wrong route, a missing await, state that never updates, an API call with no error handling, a button with no onClick. This catches a class of bugs faster than the browser will.

3. **Run the real thing and observe it.** This is the heart of proof — you must *observe* the behavior, not infer it.

   - **Anything with a UI → drive it in the browser via the Playwright MCP.** Make sure the app is actually running (start the dev server if needed and confirm it's up). Navigate to the feature, perform the real user actions (click, type, submit), and **take screenshots** at the meaningful moments. Then *actually look at the screenshots* and the page snapshot — read what's on screen, confirm the expected elements/text/state are present and the error states are absent. Check the browser console for errors. A screenshot you don't analyze is not evidence.
   - **No UI (API, CLI, library, data job) → exercise the real code.** Hit the endpoint, run the command, call the function, query the table — with real inputs — and capture the actual output. Run the project's tests if they cover the feature.

4. **Test the edges, not just the happy path.** A feature that works only when everything goes right isn't proven working. Exercise at least: the primary success case, an invalid/empty input case, and any error or boundary condition the feature is supposed to handle. These are where "done" features usually aren't.

5. **Report evidence honestly.** Summarize in the chat: what you claimed, what you did to test it, and what you observed — referencing the screenshots/output as the evidence. Give a clear verdict. Screenshots taken via Playwright are shown to the user during the run; you don't need to write a separate report file or persist them unless asked.

## What counts as sufficient evidence

The user said they won't continue without sufficient proof, so calibrate to that. Sufficient means:

- You **observed** the behavior happen (saw it on screen / saw the real output), not reasoned that it should.
- The evidence is **specific and verifiable** — "the dashboard screenshot shows the user's name 'Ada' in the header and 3 project cards" beats "looks good".
- The **important paths are covered**, including at least one failure/edge case, not just one happy click-through.
- Any gap is **stated plainly**. If you couldn't test something (no test data, a flow you couldn't reach, an external dependency), say so — don't paper over it.

## If you find it doesn't work

That's a successful use of this skill, not a failure. Report what broke with the evidence, fix it, then re-run the loop and prove the fix. Do not announce success on a feature you haven't actually seen working — a confident-but-false "it's done" is the exact outcome this skill is meant to prevent. It is always better to report "this part works, this part is still broken, here's the screenshot of the error" than to claim completion you can't back up.

## Tone in the final summary

Lead with the verdict and the evidence, not with reassurance. The user is explicitly skeptical and wants to see the proof — so show your work: the actions you took, the screenshots/output, and what each one demonstrates. Confidence should come from the evidence on screen, not from your phrasing.

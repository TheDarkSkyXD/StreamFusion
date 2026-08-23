---
name: prove
description: >-
  Prove with real, observed evidence that a feature is implemented and working.
  Use when the user asks to prove, show, verify, or confirm that a feature works,
  or before declaring a non-trivial Electron feature complete.
---

## Required: Debug Electron MCP

This skill drives Electron apps via the **Debug Electron MCP** server ([GitHub](https://github.com/TheDarkSkyXD/debug-electron-mcp) · [npm](https://www.npmjs.com/package/@debugelectron/debug-electron-mcp)).

**Before doing anything else, check that the MCP is available:**

1. Search for `debug-electron-mcp` tools using `tool_search`. If tools like `electron_screenshot`, `electron_click`, `electron_evaluate` appear — you're good, skip to the core loop.
2. If no tools are found, the MCP server is not installed. Install it:
   ```bash
   npm install -g @debugelectron/debug-electron-mcp@latest
   ```
3. Then add it to the user's global MCP config at `~/.claude/.mcp.json` if it's not already there:
   ```json
   {
     "mcpServers": {
       "debug-electron-mcp": {
         "command": "npx",
         "args": ["-y", "@debugelectron/debug-electron-mcp@latest"]
       }
     }
   }
   ```
4. After adding, tell the user: "I've installed the Debug Electron MCP. You'll need to start a new chat for the MCP tools to load — they initialize at chat startup."

### StreamFusion launch workflow

Proof must exercise the same development launch path the user runs. For StreamFusion:

1. Restart the app after the final source change so the proof cannot accidentally exercise an older process or stale build.
2. From `apps/desktop`, run:
   ```bash
   npm start
   ```
3. At `How would you like to start StreamFusion?`, enter `1` for **Electron app only (default)**.
4. Keep that command session alive. Wait until the output confirms the main and preload builds completed, the renderer dev server started, and `starting electron app...` appeared.
5. Use the Debug Electron MCP project `streamfusion-monorepo`, which is registered on port `9236`, and confirm that it reports a live app window before interacting with it.

Do not use `electron .`, `npx electron .`, `electron-vite preview`, or a previously built artifact as the normal StreamFusion proof path. Those shortcuts can bypass the project launcher or verify code that is not the code the user will run. Use them only when the task is specifically to diagnose the launcher itself, and disclose that exception.

For another Electron project, use that repository's normal development start command and make sure its Electron process has remote debugging enabled on a port available to the Debug Electron MCP.

---

# Prove It Works

The job here is to *prove*, not to *claim*. The difference matters: "I implemented the login form and it should work" is a claim. "I opened the app, typed valid credentials, clicked Sign in, and here's the screenshot of the dashboard that loaded" is proof. This skill exists because asserting success without observing it is the single most common way work gets handed back broken — so the bar is evidence the user can see, not your confidence.

Adopt an adversarial stance toward your own work. Your goal is not to confirm you succeeded; it's to *try to catch yourself failing*. If you go looking for problems and genuinely can't find any after exercising the feature for real, that's proof. If you only look for confirmation, you'll find it whether or not the feature works — which is worthless.

## The core loop

1. **Pin down the claim.** State precisely what "working" means for this feature — the specific user-visible behavior(s) that must hold. Vague claims can't be proven. If the feature has several behaviors (happy path, validation, error states), list them; you'll need evidence for each that matters.

2. **Re-read your own implementation.** Before touching the running app, look at the code you wrote with fresh, skeptical eyes. Trace the actual path the feature takes. Look for the things that compile fine but break at runtime: a handler wired to the wrong route, a missing await, state that never updates, an API call with no error handling, a button with no onClick. This catches a class of bugs faster than the browser will.

3. **Run the real thing and observe it.** This is the heart of proof — you must *observe* the behavior, not infer it. For StreamFusion, restart it with `npm start` and option `1` after the latest code changes, then confirm the fresh build and Electron launch in the command output before using the MCP.

   - **Anything with a UI → drive it in the browser via the Electron MCP.** Make sure the app is actually running (start the dev server if needed and confirm it's up). Navigate to the feature, perform the real user actions (click, type, submit), and **take screenshots** at the meaningful moments. Then *actually look at the screenshots* and the page snapshot — read what's on screen, confirm the expected elements/text/state are present and the error states are absent. Check the browser console for errors. A screenshot you don't analyze is not evidence.
   - **No UI (API, CLI, library, data job) → exercise the real code.** Hit the endpoint, run the command, call the function, query the table — with real inputs — and capture the actual output. Run the project's tests if they cover the feature.

4. **Test the edges, not just the happy path.** A feature that works only when everything goes right isn't proven working. Exercise at least: the primary success case, an invalid/empty input case, and any error or boundary condition the feature is supposed to handle. These are where "done" features usually aren't.

5. **Report evidence honestly.** Summarize in the chat: what you claimed, what you did to test it, and what you observed — referencing the screenshots/output as the evidence. Give a clear verdict. Screenshots taken via the Electron MCP are shown to the user during the run; you don't need to write a separate report file or persist them unless asked.

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

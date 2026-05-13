# Home page playbook

## Goal
Confirm the Home page renders the featured area, Live Now section, and the "Browse All Categories" CTA — or a clean error state if the streams API failed.

## Preconditions
- Dev build running via `npm run dev:mcp` (exposes Chrome DevTools Protocol on port 9222).
- StreamFusion project registered with `debug-electron-mcp` (see [`../README.md`](../README.md)).

## Steps

1. **Locate the main window**
   - Call `mcp__debug-electron-mcp__list_electron_windows`.
   - Pick the window whose URL contains `index.html` or the dev server URL.

2. **Navigate to Home**
   - Call `mcp__debug-electron-mcp__send_command_to_electron` with:
     ```js
     window.location.hash = "/";
     ```

3. **Wait for content**
   - Poll with `send_command_to_electron`:
     ```js
     !!document.querySelector("body") && document.body.innerText.includes("Browse All Categories")
     ```
   - Stop after at most ~5 seconds.

4. **Capture state**
   - `mcp__debug-electron-mcp__take_screenshot` → save as `home.png`.
   - `mcp__debug-electron-mcp__read_electron_logs` → grep for `error` lines from the renderer.

## Pass criteria
- [ ] "Browse All Categories" button is visible.
- [ ] EITHER a `data-testid="featured-stream"`-like element OR the explicit "Failed to load streams" error region is present.
- [ ] No uncaught exception in renderer logs.

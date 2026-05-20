# App launch playbook

## Goal
Confirm the Electron app launches, exposes a main window, reports a sensible title + version, and renders the sidebar shell.

## Preconditions
- Dev build running via `npm run dev:mcp` (exposes Chrome DevTools Protocol on port 9222).
- StreamFusion project registered with `debug-electron-mcp` (see [`../README.md`](../README.md)).

## Steps

1. **List windows**
   - Call `mcp__debug-electron-mcp__list_electron_windows`.
   - Expect at least one window whose URL contains `index.html` or the dev server URL.

2. **Window title sanity**
   - Call `mcp__debug-electron-mcp__get_electron_window_info` for that window.
   - Expect the title to contain `streamfusion` (case-insensitive).

3. **App version + name via main-process eval**
   - `mcp__debug-electron-mcp__send_command_to_electron` (main scope, if your server supports it; otherwise read from the renderer's exposed bridge):
     ```js
     // Renderer-side: the preload exposes app info on window.electron (if applicable).
     // Fallback shape: parse the `<title>` and any visible version banner.
     ({
       title: document.title,
       hasVersionMarker: /\d+\.\d+\.\d+/.test(document.body.innerText),
     })
     ```
   - Expect `title` to contain `streamfusion` and `hasVersionMarker` to be `true` if the app surfaces a version anywhere visible (Settings, About). If the app hides version, skip this assertion.

4. **Sidebar renders**
   - `send_command_to_electron`:
     ```js
     !!(document.querySelector('[data-testid="sidebar"]') ||
        document.querySelector('aside') ||
        document.querySelector('.sidebar'))
     ```
   - Expect `true`.

5. **No uncaught renderer errors**
   - Call `mcp__debug-electron-mcp__read_electron_logs`.
   - Grep for `Uncaught`, `TypeError`, or `Error:` in the last ~50 lines. Tolerate known dev-warnings (React DevTools nag, source-map warnings).

6. **Capture state**
   - `mcp__debug-electron-mcp__take_screenshot` → save as `app-launch.png`.

## Pass criteria
- [ ] At least one electron window is listed.
- [ ] Window title contains "streamfusion" (case-insensitive).
- [ ] Sidebar shell is present in the DOM.
- [ ] No uncaught exceptions in renderer logs since launch.

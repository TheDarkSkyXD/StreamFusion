---
date: 2026-05-28
topic: context-menu-copy-paste
---

# Right-Click Context Menu — Copy + Paste

## Summary

Add a native OS context menu to the main StreamForge window so users can right-click highlighted text to copy it, and right-click inside editable inputs/textareas to paste. The menu uses Electron's built-in `webContents` `context-menu` event with the `Menu.buildFromTemplate` roles `copy` and `paste`. No new dependencies, no IPC, no renderer-side code. The menu is intentionally minimal — Copy on selection, Paste in editables, nothing else — matching the user-chosen scope.

---

## Problem Frame

The main window is constructed in `apps/desktop/src/backend/window-manager.ts:117` as a frameless `BrowserWindow`, and `main.ts:236` calls `Menu.setApplicationMenu(null)`. The combined effect is that right-click does nothing anywhere in the app — there is no `webContents.on("context-menu", …)` listener, no `electron-context-menu` dependency, and no React `onContextMenu` handlers in the renderer. Users who select chat text, a username, a stream title, or settings text cannot copy it without the keyboard. The same gap blocks paste in the chat input and every other text field. This is a small, well-bounded usability fix.

---

## Requirements

**Menu surface**

- R1. The main window's `webContents` SHALL emit a context menu in response to OS right-click (Windows/macOS/Linux), wired via Electron's `webContents.on("context-menu", …)` event.
- R2. The menu SHALL be built with `Menu.buildFromTemplate(...)` and shown via `.popup({ window: mainWindow })` so it renders as a native OS menu (Win32 menu on Windows, NSMenu on macOS, GTK on Linux).
- R3. The menu items SHALL use Electron's built-in roles `copy` and `paste`. The implementation SHALL NOT call `clipboard.writeText` / `clipboard.readText` directly.

**Items shown**

- R4. When the right-click event reports `params.selectionText` whose trimmed value is non-empty, the menu SHALL include a single **Copy** item (`role: "copy"`).
- R5. When the right-click event reports `params.isEditable === true` (i.e., the target is an `<input>`, `<textarea>`, or `contenteditable` element), the menu SHALL include a single **Paste** item (`role: "paste"`).
- R6. When both conditions in R4 and R5 are true (text selected inside an editable field), the menu SHALL show **Copy** then **Paste**, in that order, with no separator.
- R7. When neither condition in R4 nor R5 is met (right-click on empty space, a button, an image, a link, etc.), the menu SHALL NOT be shown. Right-clicking those targets remains a no-op, preserving the current quiet behavior.

**Explicitly NOT included**

- R8. The menu SHALL NOT include Cut, Select All, Undo, Redo, Copy Image, Copy Image Address, Save Image As, Copy Link, Open Link in Browser, Inspect, or Reload. These are out of scope for this feature.
- R9. The implementation SHALL NOT add the `electron-context-menu` npm package or any other context-menu dependency.

**Scope — which windows get the menu**

- R10. The menu SHALL be installed only on the main application window created in `window-manager.ts`.
- R11. The menu SHALL NOT be installed on the auth popup window (`apps/desktop/src/backend/auth/auth-window.ts:105`) — it is transient and has no useful selectable text.
- R12. The menu SHALL NOT be installed on the offscreen API-fetching `BrowserWindow` instances in `apps/desktop/src/backend/api/platforms/kick/endpoints/{chat,channel,follow}-endpoints.ts` — these are headless utility windows with no user interaction.
- R13. Devtools and any future detached webContents SHALL retain Chromium's own built-in context menu; this feature does not attempt to override or augment them.

**Lifecycle**

- R14. The listener SHALL be attached once, immediately after `this.mainWindow = new BrowserWindow(...)` in `window-manager.ts`, and SHALL NOT need explicit removal — Electron tears down the listener with the `webContents` on window close.
- R15. The listener SHALL be safe under window recreation. If `createMainWindow()` is ever called more than once in a session, each new window SHALL get its own listener via the same attachment path.

**No regressions**

- R16. Existing places that set `document.body.style.userSelect = "none"` during drag operations (`pages/Stream/index.tsx`, `pages/MultiStream/index.tsx`, `components/dev/DebugPanel.tsx`) SHALL continue to suppress selection during the drag. Because suppressed selection means `params.selectionText` is empty, right-click during a drag SHALL also suppress the menu — this is the desired behavior and requires no code change.
- R17. The chat input's existing keyboard shortcuts (Enter, Shift+Enter, slash commands, `:` and `@` autocomplete) SHALL continue to work unchanged.
- R18. The frameless-window drag region (`-webkit-app-region: drag`) SHALL be unaffected; right-click on the drag region falls under R7 (no selection, not editable → no menu) and is a no-op.

**Verification**

- R19. Manual verification: launch the dev build, highlight chat message text, right-click — **Copy** appears, clicking it places the text on the clipboard, and a subsequent paste (Ctrl+V or right-click → Paste in the chat input) yields the same text.
- R20. Manual verification: right-click inside the chat input with no text selected — **Paste** appears alone; with text selected — **Copy** then **Paste** appear.
- R21. Manual verification: right-click empty chat background, a chat avatar image, the username button, or the frameless title-bar drag region — no menu appears.
- R22. Automated coverage: a small unit test SHALL verify the template-building function returns `[]` for the no-selection / non-editable case, `[copy]` for selection-only, `[paste]` for editable-only, and `[copy, paste]` for both. The `popup()` call itself does not need to be tested — it's a thin Electron API surface.

---

## Out of Scope

- A richer context menu (images, links, dev-tools, Cut/Select All) — explicitly deferred per scope decision.
- Context menus on the auth or offscreen utility windows.
- A renderer-side React context menu library.
- Spellcheck suggestions in the menu — Electron supports them via `params.dictionarySuggestions`, but spellcheck itself is not wired up in this app and adding it is a separate effort.
- Persisting clipboard history.

## Files Expected to Change

- `apps/desktop/src/backend/window-manager.ts` — attach the `context-menu` listener after `new BrowserWindow(...)`.
- Possibly a tiny new helper `apps/desktop/src/backend/context-menu.ts` exporting `buildContextMenuTemplate(params)` so the template-building logic is unit-testable in isolation (R22). Final decision (inline vs helper) lives in the implementation plan.
- A new test file under `apps/desktop/tests/` covering the template-building function (R22).

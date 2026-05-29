# Right-Click Context Menu (Copy + Paste) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a native Electron context menu to the main window so right-click on selected text shows **Copy**, right-click in editable inputs/textareas shows **Paste**, and right-click on anything else stays a no-op.

**Architecture:** A tiny pure helper (`buildContextMenuTemplate`) decides the template from `params.selectionText` + `params.isEditable`. A second helper (`installContextMenu`) attaches the listener to a `webContents` and calls `Menu.buildFromTemplate(...).popup({ window })`. `window-manager.ts` calls `installContextMenu(this.mainWindow.webContents)` once, immediately after `new BrowserWindow(...)`. Built-in Electron roles `copy` and `paste` handle clipboard ops natively — no IPC, no renderer code, no new dependency.

**Tech Stack:** TypeScript, Electron (`Menu`, `WebContents`, `BrowserWindow`, built-in roles), Vitest.

**Spec:** [`docs/brainstorms/2026-05-28-context-menu-copy-paste-requirements.md`](../brainstorms/2026-05-28-context-menu-copy-paste-requirements.md)

> **Commands (use EXACTLY):**
> - Typecheck: `npm --prefix "apps/desktop" run typecheck` (from repo root)
> - Full suite: `npm --prefix "apps/desktop" test` (from repo root). Do NOT run `npx vitest`/`npm exec vitest` from the repo root — wrong vitest, no `@/` alias, false mass-failures.
> - Single test file: in your Bash tool, `cd "apps/desktop"` first, then `npx vitest run tests/backend/context-menu.test.ts`.
> - Git from repo root. Stage ONLY this plan's files; unrelated WIP is in the tree; NEVER `git add -A`/`.`.

> **Baseline:** `main` is at `ff2ca8b` (this feature's spec committed). The working tree has 6 pre-existing modified files plus the untracked `apps/desktop/src/lib/settings-toast.ts` from prior WIP — leave them alone. Branch `feat/context-menu-copy-paste` off `main` before starting.

---

## File Structure

**Create (Task 1):**
- `apps/desktop/src/backend/context-menu.ts` — exports `buildContextMenuTemplate` (pure, testable) and `installContextMenu` (attaches listener to a `WebContents`).
- `apps/desktop/tests/backend/context-menu.test.ts` — unit tests for `buildContextMenuTemplate`.

**Modify (Task 2):**
- `apps/desktop/src/backend/window-manager.ts:135` — add one import line at the top and one `installContextMenu(this.mainWindow.webContents)` call after `new BrowserWindow(...)`.

**Task 3:** manual verification in the running app — no code changes.

---

## Task 1: Build the pure template helper + unit tests (TDD)

**Files:**
- Create: `apps/desktop/src/backend/context-menu.ts`
- Create: `apps/desktop/tests/backend/context-menu.test.ts`

- [ ] **Step 1: Branch off main**

```bash
git checkout main
git checkout -b feat/context-menu-copy-paste
```

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/tests/backend/context-menu.test.ts` with exactly this content:

```ts
import { describe, expect, it, vi } from "vitest";

// The production module imports from "electron" for Menu/BrowserWindow types,
// but the pure function under test only needs primitive params. Mock the
// surface we don't use so the import resolves in a non-Electron test runner.
vi.mock("electron", () => ({
  Menu: { buildFromTemplate: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}));

import { buildContextMenuTemplate } from "@/backend/context-menu";

type Input = Parameters<typeof buildContextMenuTemplate>[0];

function makeParams(overrides: Partial<Input> = {}): Input {
  return {
    selectionText: "",
    isEditable: false,
    ...overrides,
  };
}

describe("buildContextMenuTemplate", () => {
  it("returns empty template when nothing is selected and target is not editable", () => {
    expect(buildContextMenuTemplate(makeParams())).toEqual([]);
  });

  it("includes Copy when selection text is non-empty", () => {
    expect(buildContextMenuTemplate(makeParams({ selectionText: "hello" }))).toEqual([
      { role: "copy" },
    ]);
  });

  it("includes Paste when the target is editable", () => {
    expect(buildContextMenuTemplate(makeParams({ isEditable: true }))).toEqual([
      { role: "paste" },
    ]);
  });

  it("includes Copy then Paste when text is selected inside an editable", () => {
    expect(
      buildContextMenuTemplate(makeParams({ selectionText: "hi", isEditable: true })),
    ).toEqual([{ role: "copy" }, { role: "paste" }]);
  });

  it("treats whitespace-only selection as no selection", () => {
    expect(buildContextMenuTemplate(makeParams({ selectionText: "   \n\t " }))).toEqual([]);
  });

  it("still shows Paste when a whitespace-only selection is inside an editable", () => {
    expect(
      buildContextMenuTemplate(makeParams({ selectionText: " ", isEditable: true })),
    ).toEqual([{ role: "paste" }]);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
cd "apps/desktop"
npx vitest run tests/backend/context-menu.test.ts
```

Expected: all 6 tests fail with a module-resolution error along the lines of `Failed to resolve import "@/backend/context-menu"`. That's the "red" state — the production module doesn't exist yet.

- [ ] **Step 4: Create the production module**

Create `apps/desktop/src/backend/context-menu.ts` with exactly this content:

```ts
/**
 * Right-click context menu for the main window.
 *
 * `buildContextMenuTemplate` is a pure function so it can be unit-tested
 * without an Electron runtime. `installContextMenu` is the side-effecting
 * wrapper that attaches the listener to a WebContents.
 *
 * Scope: Copy on selection, Paste in editables. Spec:
 * docs/brainstorms/2026-05-28-context-menu-copy-paste-requirements.md
 */

import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

type ContextMenuInput = Pick<Electron.ContextMenuParams, "selectionText" | "isEditable">;

export function buildContextMenuTemplate(
  params: ContextMenuInput,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (params.selectionText.trim().length > 0) {
    template.push({ role: "copy" });
  }
  if (params.isEditable) {
    template.push({ role: "paste" });
  }
  return template;
}

export function installContextMenu(webContents: WebContents): void {
  webContents.on("context-menu", (_event, params) => {
    const template = buildContextMenuTemplate(params);
    if (template.length === 0) return;
    const window = BrowserWindow.fromWebContents(webContents);
    if (!window) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
cd "apps/desktop"
npx vitest run tests/backend/context-menu.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 6: Run typecheck**

From the repo root:

```bash
npm --prefix "apps/desktop" run typecheck
```

Expected: passes with no errors. If `Electron.ContextMenuParams` is not resolved, confirm the top of `apps/desktop/src/backend/context-menu.ts` imports types from `"electron"` exactly as shown in Step 4.

- [ ] **Step 7: Run the full suite to confirm nothing else broke**

From the repo root:

```bash
npm --prefix "apps/desktop" test
```

Expected: the baseline test count goes up by 6 (the new tests). Every other test still passes.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/backend/context-menu.ts apps/desktop/tests/backend/context-menu.test.ts
git commit -m "$(cat <<'EOF'
feat(context-menu): add Copy/Paste template helper + installer

Pure buildContextMenuTemplate decides menu items from selectionText +
isEditable; installContextMenu attaches the WebContents listener and
pops a native menu via built-in copy/paste roles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Confirm with `git log -1 --stat` that exactly the two files just created are in the commit — no stray WIP files.

---

## Task 2: Wire `installContextMenu` into `window-manager.ts`

**Files:**
- Modify: `apps/desktop/src/backend/window-manager.ts:10` (import line) and `apps/desktop/src/backend/window-manager.ts:135` (call after `new BrowserWindow(...)`)

- [ ] **Step 1: Add the import**

Open `apps/desktop/src/backend/window-manager.ts`. The current top-of-file imports look like this (line 10):

```ts
import { app, BrowserWindow, globalShortcut, screen, shell } from "electron";

import { markCleanShutdown } from "./shutdown-marker";
```

Add the `installContextMenu` import right after `markCleanShutdown`:

```ts
import { app, BrowserWindow, globalShortcut, screen, shell } from "electron";

import { installContextMenu } from "./context-menu";
import { markCleanShutdown } from "./shutdown-marker";
```

(Project import order is alphabetical within each group; `context-menu` sorts before `shutdown-marker`.)

- [ ] **Step 2: Add the `installContextMenu` call**

In the same file, find the end of the `new BrowserWindow({...})` block (line 135 — closing `});` of the constructor call inside `createMainWindow()`). The very next thing today is the `// Restore maximized state` comment. Insert a single line immediately after the constructor call, before the `// Restore maximized state` comment.

Existing code (lines 117–137 in the snapshot):

```ts
    this.mainWindow = new BrowserWindow({
      ...bounds,
      minWidth: 1024,
      minHeight: 768,
      backgroundColor: "#0f0f0f",
      show: false,
      frame: false, // Custom title bar
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 12, y: 12 }, // macOS traffic lights position
      webPreferences: {
        // electron-vite outputs preload to out/preload/index.js
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // Disabled to allow preload IPC
        webSecurity: false, // Allow CORS for video streams
        backgroundThrottling: false, // Prevent Chromium from pausing media when window is minimized
      },
    });

    // Restore maximized state
```

After the edit:

```ts
    this.mainWindow = new BrowserWindow({
      ...bounds,
      minWidth: 1024,
      minHeight: 768,
      backgroundColor: "#0f0f0f",
      show: false,
      frame: false, // Custom title bar
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 12, y: 12 }, // macOS traffic lights position
      webPreferences: {
        // electron-vite outputs preload to out/preload/index.js
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // Disabled to allow preload IPC
        webSecurity: false, // Allow CORS for video streams
        backgroundThrottling: false, // Prevent Chromium from pausing media when window is minimized
      },
    });

    installContextMenu(this.mainWindow.webContents);

    // Restore maximized state
```

That is the only behavioral change to `window-manager.ts`. Do not touch anything else in the file.

- [ ] **Step 3: Verify the diff is exactly two hunks**

```bash
git diff apps/desktop/src/backend/window-manager.ts
```

Expected output: one import line added near the top and one `installContextMenu(...)` call added below the BrowserWindow constructor. Nothing else. If you see other lines flagged (whitespace, autocrlf line-ending diffs on unrelated lines, etc.), undo the unintended changes — the file uses CRLF line endings per `.gitattributes`/autocrlf behavior; preserve them.

- [ ] **Step 4: Run typecheck**

```bash
npm --prefix "apps/desktop" run typecheck
```

Expected: passes.

- [ ] **Step 5: Run the full suite**

```bash
npm --prefix "apps/desktop" test
```

Expected: still all green, same +6 delta as after Task 1.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/backend/window-manager.ts
git commit -m "$(cat <<'EOF'
feat(context-menu): install on main window in window-manager

Right-click now shows Copy on text selection and Paste in editable
inputs/textareas. Empty space, buttons, images, and the drag region
remain no-ops (no template -> no popup).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Confirm with `git log -1 --stat` that the commit contains exactly `apps/desktop/src/backend/window-manager.ts` and nothing else.

---

## Task 3: Manual verification in the running app

**Files:** None — this task only runs the app and checks behavior.

- [ ] **Step 1: Start the dev build**

From the repo root:

```bash
npm --prefix "apps/desktop" start
```

Wait for the window to appear (Electron prints `ready-to-show` in the dev console).

- [ ] **Step 2: Verify Copy on a chat message**

Navigate to any channel that has chat (Twitch or Kick). Click-and-drag to highlight a few characters of a chat message. Right-click the highlighted text.

Expected:
- A native OS menu appears with a single **Copy** item.
- Click **Copy**, then focus the chat input and press Ctrl+V. The text you highlighted appears in the input.

- [ ] **Step 3: Verify Paste in the chat input**

With the clipboard still holding the text from Step 2, click into the chat input so it has focus but no selection. Right-click inside the input.

Expected:
- A native OS menu appears with a single **Paste** item.
- Click **Paste**. The text appears in the input.

- [ ] **Step 4: Verify Copy + Paste together**

Type a few characters into the chat input, then highlight one of them. Right-click the highlighted text.

Expected:
- A native OS menu appears with **Copy** above **Paste**, in that order, with no separator between them.

- [ ] **Step 5: Verify no-menu on non-text targets**

For each of the following, right-click and confirm **no menu appears at all**:
- An empty area of the chat list (between messages, or below the last message).
- A chat avatar image.
- The Username button on a chat message (a clickable element with no text selection).
- The frameless title-bar drag region at the very top of the window.
- The Send / submit button next to the chat input (if visible).

- [ ] **Step 6: Verify drag-suppression still wins**

Go to a stream page (a single Stream or a MultiStream layout). Start dragging a stream tile (the page sets `document.body.style.userSelect = "none"` during drag). Mid-drag, attempt a right-click.

Expected:
- No menu appears. Drag completes normally. (The page already prevents selection; that means `selectionText` is empty and `isEditable` is false at the right-click moment, so our `template.length === 0` guard skips the popup.)

- [ ] **Step 7: Stop the app**

Close the window normally (X button on the custom title bar).

- [ ] **Step 8: If any verification step in Steps 2–6 failed**, do NOT continue. Open a follow-up task in the conversation describing which step failed and what was seen instead. Otherwise, move to Step 9.

- [ ] **Step 9: Final sanity check before opening a PR**

```bash
git status --short
git log --oneline main..HEAD
```

Expected:
- `git status --short` shows ONLY the pre-existing WIP files that were present before this work (the 6 `M` lines and the untracked `apps/desktop/src/lib/settings-toast.ts`). Nothing else.
- `git log --oneline main..HEAD` shows exactly two commits from this plan: `feat(context-menu): add Copy/Paste template helper + installer` and `feat(context-menu): install on main window in window-manager`.

If either of those is wrong (stray staged files, extra commits, missing commits), pause and resolve before opening the PR.

# StreamFusion E2E Test Suite

End-to-end tests for the desktop app live here. There are **two complementary runners**:

| Runner | When it runs | Driver | Coverage |
|--------|--------------|--------|----------|
| **Playwright** (`./specs/*.spec.ts`) | CI + local; autonomous | Playwright Electron | Per-page smoke + nav flow |
| **MCP playbooks** (`./playbooks/*.playbook.md`) | Ad-hoc; Claude executes them | `debug-electron-mcp` (primary) or `electron-mcp-server` (fallback) | Manual / interactive smoke |

> The **MCP playbooks are the primary e2e suite** as requested by the project. Playwright is here for CI redundancy and as a programmatic fallback.

---

## Quick reference

```bash
# From apps/desktop/
npm run test:e2e          # Playwright suite (headless)
npm run test:e2e:ui       # Playwright UI mode
npm run test:e2e:debug    # Playwright debug mode

npm run dev:mcp           # Dev server with Chrome DevTools Protocol on :9222
                          #   ↑ start this *before* asking Claude to run playbooks
```

The dev:mcp script lives in `apps/desktop/package.json`:

```json
"dev:mcp": "electron-vite dev -- --remote-debugging-port=9222"
```

Once `npm run dev:mcp` is running, Claude can connect via either MCP and drive the app.

---

## E2E #1 — MCP playbooks (primary)

### What is "debug-electron-mcp"?

`debug-electron-mcp` is an MCP server that connects to a running Electron app via the **Chrome DevTools Protocol (CDP)** on a known debug port, and exposes a high-level toolset over MCP. Claude calls these tools and the server translates them to CDP commands inside your dev build.

The tools it provides (visible to Claude as `mcp__debug-electron-mcp__*`):

| Tool | Description |
|------|-------------|
| `list_projects` | List registered project paths. |
| `register_project` | Register a project root + a debug port to monitor. |
| `unregister_project` | Forget a registered project. |
| `list_electron_windows` | List BrowserWindows currently exposed via CDP. |
| `get_electron_window_info` | URL/title for a window. |
| `send_command_to_electron` | Evaluate arbitrary JS in the renderer (or main, depending on server flags). |
| `read_electron_logs` | Stream of console + process logs since registration. |
| `take_screenshot` | Captures the renderer viewport as PNG. |

### Setup — `debug-electron-mcp` (primary)

> **First time? Install the MCP server.** This is a separate package from your app dependencies. See vendor docs for the exact name; the StreamFusion CLAUDE.md docs the canonical install command. The general shape is:

1. **Install the MCP server** (one-time):

   ```bash
   # If the server is published on npm:
   npm install -g debug-electron-mcp
   # OR clone the source and follow its README.
   ```

2. **Register the MCP server with Claude Code.**
   Add an entry to your global Claude Code MCP config (location varies by OS — see `claude --help` for the path). Example:

   ```json
   {
     "mcpServers": {
       "debug-electron-mcp": {
         "command": "debug-electron-mcp",
         "args": []
       }
     }
   }
   ```

   Restart Claude Code so it picks up the new server. Once restarted, you should see `mcp__debug-electron-mcp__*` tools in Claude's tool list.

3. **Register this project with the MCP server** (one-time, from inside Claude):
   Ask Claude to call:

   ```
   mcp__debug-electron-mcp__register_project
     path: "F:/My Github Repos/Open Source Repos/StreamForge- kick, twitch desktop app/StreamForge/apps/desktop"
     port: 9222
     name: "streamfusion"
   ```

4. **Start the app in dev mode**:

   ```bash
   npm run dev:mcp
   ```

5. **Sanity-check the connection**:
   Ask Claude:

   > "List electron windows via debug-electron-mcp."

   You should get back the main StreamFusion window with its URL.

### Running a playbook

Ask Claude:

> "Run the home playbook from `apps/desktop/tests/e2e/playbooks/01-home.playbook.md`."

Claude will read the file, execute each MCP call, and report pass/fail against the listed criteria. Each playbook is self-contained and lists exact JS payloads to evaluate via `send_command_to_electron`.

For a full app sweep:

> "Run the full-app sweep playbook (`99-full-app-sweep.playbook.md`)."

### Authoring new playbooks

1. Copy `playbooks/01-home.playbook.md` as a template.
2. Keep the four sections: **Goal / Preconditions / Steps / Pass criteria**.
3. Steps should use the same MCP-call style (snippets you can paste into `send_command_to_electron`).
4. Add a row to `playbooks/README.md` index.

---

## E2E #1.5 — Fallback: `electron-mcp-server`

If you lose access to `debug-electron-mcp` (or it isn't installed yet on a new machine), the project already depends on **`electron-mcp-server`** (declared in `apps/desktop/package.json` devDependencies). It exposes a similar toolset under a different prefix. Use it as a drop-in fallback for the playbooks — the steps still apply, you'll just substitute tool names:

| `debug-electron-mcp` | `electron-mcp-server` equivalent |
|----------------------|----------------------------------|
| `list_electron_windows` | `list_windows` / equivalent (see the server's docs) |
| `send_command_to_electron` | `execute_js` / `evaluate` (see the server's docs) |
| `take_screenshot` | `screenshot` |
| `read_electron_logs` | `get_logs` |

### Setup — `electron-mcp-server` (fallback)

It's already a dev dependency, so:

```bash
# From apps/desktop/
# Run the server pointing at the running app. The exact CLI may differ
# per version — start with --help to confirm:
npx electron-mcp-server --help
```

A typical setup:

1. Start the app with the same `npm run dev:mcp` (port 9222).
2. In a second terminal, run the MCP server pointed at port 9222.
3. Add it to Claude Code's MCP config:

   ```json
   {
     "mcpServers": {
       "electron-mcp-server": {
         "command": "npx",
         "args": ["electron-mcp-server"]
       }
     }
   }
   ```

4. Restart Claude Code.

When using this fallback, the playbooks' **JS payloads remain identical** — only the MCP tool name you invoke changes.

---

## E2E #2 — Playwright specs (autonomous, CI-runnable)

The Playwright suite is in `./specs/*.spec.ts`. It uses the existing `_electron.launch()` API and the fixture in `./fixtures/electron-app.ts` (no changes from how it already worked — these specs slot in alongside the original `app-launch.spec.ts`).

### Running

```bash
npm run test:e2e            # headless run
npm run test:e2e:ui         # interactive UI mode
npm run test:e2e:debug      # step-through debugger
```

### What's covered

Each spec exercises **one page** via the production hash router (`window.location.hash = "/route"`), waits for a route-specific heading or sentinel, and then asserts at least one user-visible thing — without depending on real API data (so it stays green offline).

| Spec | Route(s) |
|------|----------|
| `app-launch.spec.ts` (existing) | Window/IPC sanity |
| `home.spec.ts` | `/` |
| `following.spec.ts` | `/following` |
| `categories.spec.ts` | `/categories` |
| `category-detail.spec.ts` | `/categories/:platform/:id` |
| `search.spec.ts` | `/search?q=...` |
| `stream.spec.ts` | `/stream/:platform/:channel` |
| `video.spec.ts` | `/video/:platform/:videoId` |
| `clip.spec.ts` | `/clip/:platform/:clipId` |
| `multistream.spec.ts` | `/multistream` |
| `history.spec.ts` | `/history` |
| `downloads.spec.ts` | `/downloads` |
| `settings.spec.ts` | `/settings` |
| `navigation.spec.ts` | Sweep through every page |

### Fixtures / page objects

- `fixtures/electron-app.ts` — launches Electron and exposes `electronApp` + `mainWindow`.
- `page-objects/AppNavigation.ts` — shared `open()` / `waitForHeading()` helpers used across specs.
- `page-objects/MainWindow.ts` — the broader main-window page object (already in repo).

### Adding a new spec

Steal the shape of `home.spec.ts`:

```ts
import { expect, test } from '../fixtures/electron-app';
import { AppNavigation } from '../page-objects/AppNavigation';

test.describe('My new page', () => {
  test('renders main affordance', async ({ mainWindow }) => {
    const nav = new AppNavigation(mainWindow);
    await nav.open('/my-new-page');
    await nav.waitForHeading(/my new page/i);
  });
});
```

Keep specs **offline-safe**: don't assert on data that requires Twitch/Kick auth or live API calls. If you need real data, gate the spec on `process.env.STREAMFUSION_E2E_AUTH === 'true'`.

---

## Unit tests vs E2E — boundary

| What it tests | Where |
|---------------|-------|
| Per-component rendering, branches, callbacks | `apps/desktop/tests/components/**/*.test.tsx` (vitest) |
| Per-page rendering with mocked hooks/stores | `apps/desktop/tests/pages/*.test.tsx` (vitest) |
| Real Electron app, real router, real DOM | `apps/desktop/tests/e2e/specs/*.spec.ts` (Playwright) |
| Manual Claude-driven smoke / regression | `apps/desktop/tests/e2e/playbooks/*.playbook.md` (MCP) |

Unit tests are owned by `npm test` (vitest). E2E is owned by `npm run test:e2e` (Playwright). Playbooks are owned by Claude.

---

## Troubleshooting

- **Playwright says "browser not found"** — run `npx playwright install` once.
- **`npm run test:e2e` fails to find the binary** — the spec builds against `out/StreamFusion-<platform>-<arch>/`. Run `npm run build` first, OR set `ELECTRON_IS_PACKAGED=false` and run against the Vite dev output (default).
- **MCP says "no windows found"** — confirm the dev server was started with `npm run dev:mcp` (not `npm run dev`). The `--remote-debugging-port=9222` flag is what exposes CDP.
- **Playbook step fails on a selector** — the playbooks rely on stable text strings and roles. If a page changed copy, update the corresponding playbook + the matching `*.spec.ts`.
- **Claude can't see the MCP tools** — restart Claude Code after editing its MCP config. Tool names: look for `mcp__debug-electron-mcp__*` or `mcp__electron-mcp-server__*` in the available tool list.

---

## File map

```
tests/
├── adblock/               # Pre-existing ad-block unit tests (untouched)
├── components/            # Component unit tests (vitest)
│   ├── auth/
│   ├── chat/
│   ├── discovery/
│   ├── icons/
│   ├── layout/
│   ├── multistream/
│   ├── player/
│   ├── search/
│   ├── stream/
│   ├── TopNavBar/
│   └── ui/
├── pages/                 # Per-page unit tests (vitest)
├── test-utils.tsx         # Shared render/mocks for vitest
├── setup.ts               # vitest global setup (matchMedia mock)
└── e2e/
    ├── README.md          # ← you are here
    ├── playwright.config.ts
    ├── fixtures/
    │   ├── electron-app.ts
    │   └── test-utils.ts
    ├── page-objects/
    │   ├── AppNavigation.ts
    │   └── MainWindow.ts
    ├── specs/             # Autonomous Playwright specs (one per page + nav sweep)
    ├── screenshots/       # Output dir (gitignored conventionally)
    └── playbooks/         # MCP-driven scenario scripts (Claude executes)
        ├── README.md
        ├── 01-home.playbook.md
        ├── 02-following.playbook.md
        ├── 03-categories.playbook.md
        ├── 04-category-detail.playbook.md
        ├── 05-search-results.playbook.md
        ├── 06-stream.playbook.md
        ├── 07-video.playbook.md
        ├── 08-clip.playbook.md
        ├── 09-multistream.playbook.md
        ├── 10-history.playbook.md
        ├── 11-downloads.playbook.md
        ├── 12-settings.playbook.md
        └── 99-full-app-sweep.playbook.md
```

# StreamFusion E2E Test Suite

End-to-end tests for the desktop app live here. The suite is **MCP-playbook-driven**: Claude (or another MCP client) executes each playbook against a running StreamFusion dev build via the `debug-electron-mcp` server.

Playbooks are intentionally markdown checklists, not code. They're authored to be read top-to-bottom and to expose every selector, route, and assertion to the eye — so a person can verify what's being checked without running anything, and a regressed playbook can be diffed against the page that broke it.

> **Why no Playwright?** A Playwright spec runner used to live alongside the playbooks but was never wired into CI and the build-target path drifted. We removed it in favor of the single MCP-driven path. See `docs/test-audit/2026-05-19-audit-log.md` for the audit-trail context.

---

## Quick reference

```bash
# From apps/desktop/
npm run dev:mcp           # Dev server with Chrome DevTools Protocol on :9222
                          #   ↑ start this *before* asking Claude to run playbooks
```

The `dev:mcp` script lives in `apps/desktop/package.json`:

```json
"dev:mcp": "electron-vite dev -- --remote-debugging-port=9222"
```

Once `npm run dev:mcp` is running, Claude can connect via either MCP server (see below) and drive the app.

---

## MCP playbooks

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

5. **Sanity-check the connection** by running the app-launch playbook:

   > "Run the app-launch playbook (`apps/desktop/tests/e2e/playbooks/00-app-launch.playbook.md`)."

### Running a playbook

Ask Claude:

> "Run the home playbook from `apps/desktop/tests/e2e/playbooks/01-home.playbook.md`."

Claude reads the file, executes each MCP call, and reports pass/fail against the listed criteria. Each playbook is self-contained and lists exact JS payloads to evaluate via `send_command_to_electron`.

For a full app sweep:

> "Run the full-app sweep playbook (`99-full-app-sweep.playbook.md`)."

### Authoring new playbooks

1. Copy `playbooks/01-home.playbook.md` as a template.
2. Keep the four sections: **Goal / Preconditions / Steps / Pass criteria**.
3. Steps should use the same MCP-call style (snippets you can paste into `send_command_to_electron`).
4. Add a row to `playbooks/README.md` index.

---

## Fallback: `electron-mcp-server`

If you lose access to `debug-electron-mcp` (or it isn't installed yet on a new machine), the project already depends on **`electron-mcp-server`** (declared in `apps/desktop/package.json` devDependencies). It exposes a similar toolset under a different prefix. Use it as a drop-in fallback for the playbooks — the steps still apply, you'll just substitute tool names:

| `debug-electron-mcp` | `electron-mcp-server` equivalent |
|----------------------|----------------------------------|
| `list_electron_windows` | `list_windows` / equivalent (see the server's docs) |
| `send_command_to_electron` | `execute_js` / `evaluate` (see the server's docs) |
| `take_screenshot` | `screenshot` |
| `read_electron_logs` | `get_logs` |

### Setup — `electron-mcp-server` (fallback)

It's already a dev dependency:

```bash
# From apps/desktop/
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

## Unit tests vs E2E — boundary

| What it tests | Where |
|---------------|-------|
| Per-component rendering, branches, callbacks | `apps/desktop/tests/components/**/*.test.tsx` (vitest) |
| Per-page rendering with mocked hooks/stores | `apps/desktop/tests/pages/*.test.tsx` (vitest) |
| Real Electron app, real router, real DOM | `apps/desktop/tests/e2e/playbooks/*.playbook.md` (MCP-driven) |

Unit tests are owned by `npm test` (vitest). E2E is owned by Claude executing the playbooks.

---

## Troubleshooting

- **MCP says "no windows found"** — confirm the dev server was started with `npm run dev:mcp` (not `npm run dev`). The `--remote-debugging-port=9222` flag is what exposes CDP.
- **Playbook step fails on a selector** — the playbooks rely on stable text strings and roles. If a page changed copy, update the corresponding playbook.
- **Claude can't see the MCP tools** — restart Claude Code after editing its MCP config. Tool names: look for `mcp__debug-electron-mcp__*` or `mcp__electron-mcp-server__*` in the available tool list.

---

## File map

```
tests/
├── adblock/               # Pre-existing ad-block unit tests
├── backend/               # Backend service + API client unit tests (vitest)
├── components/            # Component unit tests (vitest)
├── hooks/                 # Hook unit tests (vitest)
├── lib/                   # Library function tests (vitest)
├── pages/                 # Per-page unit tests (vitest)
├── shared/                # Shared type/contract tests (vitest)
├── store/                 # Zustand store tests (vitest)
├── helpers/               # Test helpers (e.g. the better-sqlite3 shim)
├── test-utils.tsx         # Shared render/mocks for vitest
├── setup.ts               # vitest global setup (matchMedia, ResizeObserver mocks)
├── AGENTS.md              # Per-test conventions (Keep/Rewrite/Delete + // Guards:)
└── e2e/
    ├── README.md          # ← you are here
    └── playbooks/         # MCP-driven scenario scripts (Claude executes)
        ├── README.md
        ├── 00-app-launch.playbook.md
        ├── 00b-sidebar-navigation.playbook.md
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

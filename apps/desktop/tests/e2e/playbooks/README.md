# MCP E2E Playbooks

These are scenario scripts that **Claude (or another MCP client)** executes against a running StreamFusion dev build via the `debug-electron-mcp` server. Each playbook is a self-contained checklist Claude can follow step-by-step using the MCP tools listed below.

The playbooks **do not run on CI** — for autonomous CI coverage use the Playwright specs in `../specs`. The playbooks exist for:

- Interactive smoke-testing during development.
- Reproducing user reports inside Claude.
- Validating new pages/features before committing.

## MCP toolset used

All playbooks call these tools (the `debug-electron-mcp` namespace):

| Tool | Purpose |
|------|---------|
| `mcp__debug-electron-mcp__list_projects` | See which projects are registered. |
| `mcp__debug-electron-mcp__register_project` | One-time setup — register StreamFusion's path + debug port. |
| `mcp__debug-electron-mcp__list_electron_windows` | Find the main window's debug target. |
| `mcp__debug-electron-mcp__get_electron_window_info` | Title/URL of a window — sanity check. |
| `mcp__debug-electron-mcp__send_command_to_electron` | Run arbitrary JS in the renderer (DOM queries, route changes, clicks). |
| `mcp__debug-electron-mcp__read_electron_logs` | Read recent renderer/main logs for assertions. |
| `mcp__debug-electron-mcp__take_screenshot` | Visual evidence of the resulting state. |

See [`../README.md`](../README.md) for setup, including the `electron-mcp-server` fallback if `debug-electron-mcp` is unavailable.

## Playbook conventions

Every playbook follows this skeleton:

```
1. Goal: <one sentence>
2. Preconditions: <app dev build running, etc>
3. Steps: numbered list of MCP calls + expected outcomes
4. Pass criteria: bullets that must all be true at end
```

When you ask Claude to "run the home playbook," Claude reads the corresponding file, executes each MCP call in order, and reports pass/fail against the criteria. If any step fails, Claude takes a screenshot, dumps recent logs, and stops.

## Playbook index

| Page | File |
|------|------|
| Home | [01-home.playbook.md](01-home.playbook.md) |
| Following | [02-following.playbook.md](02-following.playbook.md) |
| Categories | [03-categories.playbook.md](03-categories.playbook.md) |
| Category Detail | [04-category-detail.playbook.md](04-category-detail.playbook.md) |
| Search Results | [05-search-results.playbook.md](05-search-results.playbook.md) |
| Stream (live) | [06-stream.playbook.md](06-stream.playbook.md) |
| Video (VOD) | [07-video.playbook.md](07-video.playbook.md) |
| Clip | [08-clip.playbook.md](08-clip.playbook.md) |
| MultiStream | [09-multistream.playbook.md](09-multistream.playbook.md) |
| History | [10-history.playbook.md](10-history.playbook.md) |
| Downloads | [11-downloads.playbook.md](11-downloads.playbook.md) |
| Settings | [12-settings.playbook.md](12-settings.playbook.md) |
| Full app sweep | [99-full-app-sweep.playbook.md](99-full-app-sweep.playbook.md) |

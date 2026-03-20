# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-10
**Commit:** ef88e2a
**Branch:** test

## OVERVIEW

StreamFusion is an Electron desktop app for viewing Twitch and Kick streams. Built with React 19, Vite 7, TypeScript 5.6, Zustand 5, TanStack Query/Router, Tailwind 4, and HLS.js.

## STRUCTURE

```
StreamFusion/
├── src/
│   ├── main.ts              # Electron main process entry
│   ├── preload/             # IPC bridge (contextBridge)
│   ├── renderer.tsx         # React bootstrap
│   ├── App.tsx              # Provider stack
│   ├── routes/              # TanStack Router config
│   ├── backend/             # Main process logic (see backend/AGENTS.md)
│   │   ├── api/             # Platform clients (see api/platforms/AGENTS.md)
│   │   ├── ipc/handlers/    # Modular IPC handlers
│   │   ├── auth/            # OAuth flows, token management
│   │   └── services/        # Database, storage
│   ├── components/
│   │   ├── player/          # Video playback (see player/AGENTS.md)
│   │   ├── ui/              # Radix-based primitives
│   │   ├── stream/          # Stream cards, grids
│   │   ├── auth/            # Login, profile
│   │   └── layout/          # Sidebar, TitleBar
│   ├── store/               # Zustand stores (see store/AGENTS.md)
│   ├── hooks/               # React hooks, TanStack Query
│   ├── pages/               # Route components
│   └── shared/              # Cross-process types, IPC channels
├── documentation/           # Feature specs, roadmap (has own AGENTS.md)
├── forge.config.ts          # Electron Forge packaging
├── vite.*.config.ts         # Vite configs (main/preload/renderer)
└── tailwind.config.js       # Brand colors, theme tokens
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add IPC channel | `src/shared/ipc-channels.ts` | Define channel, add handler in `backend/ipc/handlers/` |
| Add new page | `src/pages/` + `src/routes/router.tsx` | PascalCase dir, register route |
| Platform API | `src/backend/api/platforms/{kick,twitch}/` | Mirror structure between platforms |
| UI component | `src/components/ui/` | Radix + CVA pattern |
| State management | `src/store/` | Zustand with persist middleware |
| Video playback | `src/components/player/` | See player/AGENTS.md |
| Auth flow | `src/backend/auth/` | OAuth, device code, tokens |
| Database | `src/backend/services/database-service.ts` | SQLite via better-sqlite3 |

## CONVENTIONS

### Path Aliases (tsconfig)
- `@/*` → `src/*`
- `@backend/*` → `src/backend/*`
- `@shared/*` → `src/shared/*`

### File Naming
- Components: PascalCase (`StreamCard.tsx`)
- Hooks: camelCase with `use` prefix (`useAuth.ts`)
- Stores: kebab-case with `-store` suffix (`auth-store.ts`)
- Handlers: kebab-case with `-handlers` suffix

### Import Order (ESLint enforced)
1. Builtin (node:)
2. External (react, electron)
3. Internal (@/)
4. Relative (./)

### Platform Colors (Tailwind)
- `storm-accent`: `#dc143c` (brand red)
- `twitch`: `#9146ff`
- `kick`: `#53fc18`
- `background`: `#0f0f0f` (dark theme)

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** expose `ipcRenderer` directly - use preload bridge
- **NEVER** log tokens or credentials
- **NEVER** use `as any` or `@ts-ignore`
- **DEPRECATED**: Generic storage channels (`store:get/set`) - use specific handlers
- **DO NOT** call `recoverMediaError()` for non-media errors in HLS player

## UNIQUE STYLES

### IPC Pattern
1. Define channel in `src/shared/ipc-channels.ts`
2. Add typed payload in `IpcPayloads` interface
3. Expose in `src/preload/index.ts`
4. Register handler in `src/backend/ipc/handlers/*.ts`

### Clean Shutdown Sentinel
App writes `.clean-shutdown` file on exit. On startup, if missing, clears cache to prevent corruption.

### Custom Protocol
`streamfusion://` registered for OAuth callbacks.

### Kick CDN Headers
Request interceptor adds `Referer: https://kick.com/` for Kick image domains.

## COMMANDS

```bash
# Development
npm start              # electron-forge start (Vite HMR)

# Quality
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/
npm run lint:fix       # eslint --fix
npm run format         # prettier

# Build
npm run package        # electron-forge package
npm run make           # Create installers (Squirrel/DMG/DEB/RPM)
```

## DEPENDENCY VULNERABILITY CHECKING (MANDATORY)

**CRITICAL**: Before adding, updating, or recommending ANY dependency, you MUST check it against the OSV.dev vulnerability database.

### When to Check

| Trigger | Action |
|---------|--------|
| Adding new dependency | Check BEFORE adding to package.json |
| Updating dependency version | Check target version for vulnerabilities |
| Reviewing existing dependencies | Audit current versions periodically |
| User asks to install/update package | Check and warn if vulnerable |

### OSV.dev API Usage

**Endpoint**: `POST https://api.osv.dev/v1/query`

**Check single package version:**
```bash
curl -X POST https://api.osv.dev/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "package": {
      "name": "package-name",
      "ecosystem": "npm"
    },
    "version": "1.2.3"
  }'
```

**Check multiple packages (batch):**
```bash
curl -X POST https://api.osv.dev/v1/querybatch \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      {"package": {"name": "lodash", "ecosystem": "npm"}, "version": "4.17.20"},
      {"package": {"name": "axios", "ecosystem": "npm"}, "version": "0.21.0"}
    ]
  }'
```

**Response Interpretation:**
- Empty `vulns` array = ✅ No known vulnerabilities
- Non-empty `vulns` array = ⚠️ Vulnerabilities exist - find safe version

### Finding Safe Versions

When a vulnerability is found:

1. **Query without version** to get ALL vulnerabilities for the package:
```bash
curl -X POST https://api.osv.dev/v1/query \
  -d '{"package": {"name": "vulnerable-pkg", "ecosystem": "npm"}}'
```

2. **Check the `affected` ranges** in the response to find:
   - `introduced`: Version where vulnerability was introduced
   - `fixed`: Version where vulnerability was patched

3. **Select the LATEST version that is NOT in any vulnerable range**

4. **Verify the selected version** by querying it specifically

### Version Selection Priority

**ALWAYS prefer**: Latest stable version that has NO vulnerabilities

```
Priority Order:
1. Latest version (check if vulnerable)
2. If vulnerable → Find latest PATCHED version
3. If no patch exists → Find latest version BEFORE vulnerability was introduced
4. If all versions vulnerable → WARN user, suggest alternatives
```

### Example Workflow

```markdown
## User Request: "Add axios to the project"

### Step 1: Check latest version
npm view axios version  # e.g., 1.7.2

### Step 2: Query OSV.dev
curl -X POST https://api.osv.dev/v1/query \
  -d '{"package": {"name": "axios", "ecosystem": "npm"}, "version": "1.7.2"}'

### Step 3: Interpret result
- If vulns: [] → Safe to install: npm install axios@1.7.2
- If vulns: [...] → Find fixed version from affected.ranges[].events

### Step 4: Report to user
"axios@1.7.2 has no known vulnerabilities. Installing..."
OR
"axios@1.7.2 has CVE-XXXX-YYYY. Safe version: 1.7.3. Installing 1.7.3 instead."
```

### OSV-Scanner CLI (Alternative)

For bulk scanning of existing dependencies:

```bash
# Install OSV-Scanner
go install github.com/google/osv-scanner/cmd/osv-scanner@latest

# Scan package.json / package-lock.json
osv-scanner --lockfile=package-lock.json

# Scan entire project
osv-scanner -r .
```

### Integration with This Project

**For StreamFusion dependencies**, always:
1. Check the package on https://osv.dev/list?ecosystem=npm&q=PACKAGE_NAME
2. Query the API for the specific version
3. If vulnerable, find and use the latest safe version
4. Document any security considerations in commit messages

### Response Format Reference

```json
{
  "vulns": [
    {
      "id": "GHSA-xxxx-yyyy-zzzz",
      "summary": "Description of vulnerability",
      "affected": [
        {
          "package": {"name": "pkg", "ecosystem": "npm"},
          "ranges": [
            {
              "type": "ECOSYSTEM",
              "events": [
                {"introduced": "0"},
                {"fixed": "1.2.4"}
              ]
            }
          ]
        }
      ],
      "severity": [{"type": "CVSS_V3", "score": "CVSS:3.1/..."}]
    }
  ]
}
```

### Anti-Patterns (BLOCKING)

- **NEVER** add a dependency without checking OSV.dev first
- **NEVER** recommend an old version just because it's "stable" - check for vulns
- **NEVER** ignore vulnerabilities - always find a safe version or warn user
- **NEVER** use versions with CRITICAL/HIGH severity vulnerabilities without explicit user approval

## NOTES

- **No tests yet** - Testing infrastructure planned but not implemented
- **Kick API limitations** - Uses legacy/public APIs as fallback; may break
- **webSecurity disabled** - Required for cross-origin video playback
- **Frame: false** - Custom titlebar, no native frame
- LSP not available in this environment - rely on grep/ast-grep

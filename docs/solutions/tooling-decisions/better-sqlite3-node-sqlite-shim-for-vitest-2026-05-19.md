---
title: Alias better-sqlite3 → node:sqlite shim in vitest so DB tests run without rebuilding the Electron-targeted binary
module: apps/desktop/tests/helpers/better-sqlite3-shim
date: 2026-05-19
category: tooling-decisions
problem_type: tooling_decision
component: testing_framework
severity: medium
applies_when:
  - "Writing or running vitest tests that import code which imports better-sqlite3"
  - "Adding a new test that exercises DatabaseService or any module that depends on it"
  - "Updating the better-sqlite3 API surface used by production code (the shim only covers the subset we actually call)"
tags: [better-sqlite3, node-sqlite, vitest, electron, native-modules, testing]
---

# Alias better-sqlite3 → node:sqlite shim in vitest so DB tests run without rebuilding the Electron-targeted binary

## Context

`better-sqlite3` is a C++ native module. Compiled `.node` binaries are pinned to a specific `NODE_MODULE_VERSION` — Electron 35 expects 133, system Node 24 expects 137. The repo ships the binary compiled against Electron's version so `npm start` works; vitest runs under system Node and would crash on `require("better-sqlite3")` with a `NODE_MODULE_VERSION` mismatch error.

The previous workaround was a `describe.skipIf(!SQLITE_AVAILABLE)` pattern (see prior `database-service.test.ts` history): a top-of-file `try { new Database(":memory:") }` probe that gracefully skipped 7 DB tests when the binary was Electron-targeted. The skip behavior was load-bearing — running DB tests required `npm rebuild better-sqlite3` (rebuild for Node) → run tests → `npm run rebuild-deps` (rebuild for Electron). A binary-swap dance every time, and 7 tests permanently "passing" in CI without actually executing in default state.

## Guidance

Use a `node:sqlite`-backed shim aliased via `vitest.config.ts`. The Electron-targeted binary stays installed; vitest never touches it.

```typescript
// apps/desktop/vitest.config.ts
test: {
  alias: {
    // ... other aliases ...
    'better-sqlite3': path.resolve(__dirname, './tests/helpers/better-sqlite3-shim.ts'),
  },
}
```

The shim wraps Node 22+'s built-in `node:sqlite` (`DatabaseSync`) and exposes the better-sqlite3 API surface our `DatabaseService` actually uses: `new Database(path, { readonly? })`, `.exec(sql)`, `.prepare(sql) → run/get/all`, `.pragma(name)` (handles both SET and READ forms), `.close()`. Named parameters via `@-prefix` (`INSERT … VALUES (@id, @name)`) flow through cleanly because `node:sqlite` accepts the same `{ id, name }` object shape better-sqlite3 does.

```typescript
// apps/desktop/tests/helpers/better-sqlite3-shim.ts (excerpt)
class BetterSqlite3Shim {
  private inner: DatabaseSync;

  constructor(filename: string, options: ConstructorOptions = {}) {
    this.inner = new DatabaseSync(filename, { readOnly: options.readonly === true });
  }

  prepare(sql: string): Statement {
    const stmt = this.inner.prepare(sql);
    return {
      run: (...params) => {
        const result = stmt.run(...params);
        return {
          changes: Number(result.changes ?? 0),
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
    };
  }

  pragma(directive: string): unknown {
    if (directive.includes("=")) {
      this.inner.exec(`PRAGMA ${directive}`);
      return [];
    }
    return this.inner.prepare(`PRAGMA ${directive}`).all();
  }

  close(): void { this.inner.close(); }
}

export default BetterSqlite3Shim;
export { BetterSqlite3Shim as Database }; // mirrors better-sqlite3's named type export
```

`DatabaseService.ts` imports remain literally `import Database from "better-sqlite3"`. The alias makes it test-time-only. Production code is unchanged; the Electron-targeted binary continues to power `npm start`.

## Why This Matters

- **Tests stop lying.** The previous skip pattern produced "1219 passed, 7 skipped" as the default state. Skipped tests don't catch regressions — `DatabaseService` schema migration code went un-exercised in CI unless someone remembered the rebuild dance.
- **No binary-swap toil.** `npm rebuild better-sqlite3` → run tests → `npm run rebuild-deps` is two minutes of waiting per test cycle, plus the cognitive overhead of "what state is the binary in right now?" The shim removes the question entirely.
- **No accidental data loss anxiety.** Rebuilding the binary doesn't touch the SQLite file at `userData/streamfusion.db`, but contributors reasonably worry about it (especially with a 286 KB DB they've been populating for weeks). The shim removes the need to ever rebuild.
- **The shim isolates the experimental-API risk.** `node:sqlite` is marked Experimental in Node and could shift behavior across 22.x point releases. Because the shim is a single test-only file with a focused parity test suite, any breakage shows up in `tests/helpers/better-sqlite3-shim.test.ts` first — not in 7+ scattered DB tests with confusing failure modes.

## When to Apply

- Any new vitest test that imports `DatabaseService` (or any module that transitively imports `better-sqlite3`). Use plain `describe(...)` — the legacy `SQLITE_AVAILABLE` probe is no longer needed.
- When extending `DatabaseService` with a better-sqlite3 API the shim doesn't already cover (e.g., `db.transaction(fn)`, `stmt.iterate`, custom collations). The shim should be extended FIRST and a parity test added BEFORE the production code starts depending on the new method — otherwise tests will silently pass via the shim while production fails.

Do NOT use the shim for:
- Production code at runtime. The alias is `vitest.config.ts`-only; main-process code still uses the real native binding.
- Performance-critical SQL benchmarks where the C++ binding's speed matters. node:sqlite is fast but not identical.
- Validating SQLite feature-flags (e.g., FTS5, JSON1 extensions) that ship-compiled into better-sqlite3 but not node:sqlite. Run those against the real binary on the integration tier instead.

## Examples

**Before (skip-on-mismatch pattern, requires binary rebuild for tests to actually run):**

```typescript
// tests/backend/services/database-service.test.ts
import Database from "better-sqlite3";

const SQLITE_AVAILABLE = (() => {
  try { new Database(":memory:").close(); return true; }
  catch { return false; }
})();
const describeDb = SQLITE_AVAILABLE ? describe : describe.skip;

describeDb("DatabaseService schema", () => { /* ... */ });
```

CI/local default state: `1219 passed, 7 skipped`. Running the 7 tests requires `npm rebuild better-sqlite3` first.

**After (shim alias, tests run zero-skip out of the box):**

```typescript
// tests/backend/services/database-service.test.ts
import Database from "better-sqlite3";  // resolves to the shim via vitest alias

const describeDb = describe;  // no probe, no skip

describeDb("DatabaseService schema", () => { /* ... */ });
```

CI/local default state: `1245 passed, 0 skipped`. No rebuild dance. The Electron-targeted `.node` binary stays put for `npm start`.

**Extending the shim — adding `db.transaction(fn)` when DatabaseService starts using it:**

1. Add the method to `BetterSqlite3Shim` in `tests/helpers/better-sqlite3-shim.ts`.
2. Add a parity test in `tests/helpers/better-sqlite3-shim.test.ts` confirming the new method behaves like better-sqlite3 (commits on success, rolls back on throw).
3. Then ship the production change in `DatabaseService`.

The order matters: extending the shim after the production code lands means tests pass via untested shim code paths. The parity test is the tripwire that lets you trust the substitution.

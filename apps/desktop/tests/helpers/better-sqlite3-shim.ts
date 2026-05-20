/**
 * Test-only shim that lets vitest run DatabaseService tests without
 * rebuilding the native `better-sqlite3` binary against system Node.
 *
 * The repo ships better-sqlite3 compiled for Electron's NODE_MODULE_VERSION;
 * vitest runs under system Node and would fail to load it. Rather than
 * forcing a binary rebuild dance every time the suite runs, we alias
 * `better-sqlite3` to this file in `vitest.config.ts`. The shim wraps Node
 * 22+'s built-in `node:sqlite` (DatabaseSync) and exposes the subset of
 * the better-sqlite3 API our production code actually uses:
 *
 *   - `new Database(path, { readonly? })` constructor
 *   - `.exec(sql)`
 *   - `.prepare(sql)` returning `.run / .get / .all`
 *   - `.pragma(name)` — covers SET (`journal_mode = WAL`) and READ (`table_info(x)`)
 *   - `.close()`
 *
 * Anything unsupported by `node:sqlite` (e.g. `db.transaction(fn)`) is
 * intentionally absent — production code in `database-service.ts` doesn't
 * use it. Add to the shim only when a real call site demands it.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

interface ConstructorOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
  verbose?: (...args: unknown[]) => void;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

class BetterSqlite3Shim {
  private inner: DatabaseSync;

  constructor(filename: string, options: ConstructorOptions = {}) {
    this.inner = new DatabaseSync(filename, {
      readOnly: options.readonly === true,
    });
  }

  exec(sql: string): void {
    this.inner.exec(sql);
  }

  prepare(sql: string): Statement {
    const stmt: StatementSync = this.inner.prepare(sql);
    // node:sqlite's run/get/all overloads expect either positional varargs or
    // a leading named-params object — typed as SQLInputValue/Record. Cast to
    // a loose varargs signature so we can forward the better-sqlite3 calling
    // convention transparently.
    type RunSig = (...args: unknown[]) => {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    type GetSig = (...args: unknown[]) => unknown;
    type AllSig = (...args: unknown[]) => unknown[];
    const runFn = stmt.run.bind(stmt) as unknown as RunSig;
    const getFn = stmt.get.bind(stmt) as unknown as GetSig;
    const allFn = stmt.all.bind(stmt) as unknown as AllSig;

    return {
      run: (...params: unknown[]): RunResult => {
        const result = runFn(...params);
        return {
          changes: Number(result.changes ?? 0),
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: unknown[]): unknown => getFn(...params),
      all: (...params: unknown[]): unknown[] => allFn(...params),
    };
  }

  /**
   * better-sqlite3 exposes `.pragma()` as both a setter ("journal_mode = WAL")
   * and a reader ("table_info(t)" → row[]). `node:sqlite` only has `.exec` /
   * `.prepare`, so we route setters through exec and readers through prepare.
   */
  pragma(directive: string): unknown {
    if (directive.includes("=")) {
      this.inner.exec(`PRAGMA ${directive}`);
      return [];
    }
    return this.inner.prepare(`PRAGMA ${directive}`).all();
  }

  close(): void {
    this.inner.close();
  }
}

// `better-sqlite3` has both a default export (the constructor) AND a named
// `Database` type. Mirror both so `import Database from 'better-sqlite3'` and
// `Database.Database` references in TypeScript both resolve.
export default BetterSqlite3Shim;
export { BetterSqlite3Shim as Database };

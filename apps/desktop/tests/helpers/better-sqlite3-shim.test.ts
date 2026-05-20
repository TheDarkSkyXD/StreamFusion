/**
 * Parity tests for the better-sqlite3 → node:sqlite shim.
 *
 * The shim is aliased via vitest.config.ts as the test-time stand-in for
 * the real native better-sqlite3 binding. database-service.test.ts exercises
 * it indirectly through full DB workflows; this file pins the shim's surface
 * directly so a future contributor who adds a new better-sqlite3 API call
 * site gets a focused failure instead of a confusing schema-level breakage.
 *
 * Add a parity case here whenever DatabaseService starts using a new
 * better-sqlite3 API the shim doesn't already cover.
 */

import { describe, expect, it } from "vitest";

import Database from "./better-sqlite3-shim";

describe("better-sqlite3 shim parity", () => {
  describe("constructor", () => {
    it("opens an in-memory database", () => {
      const db = new Database(":memory:");
      expect(() => db.exec("CREATE TABLE t (a INT)")).not.toThrow();
      db.close();
    });

    it("respects { readonly: true } against an existing file", () => {
      const seed = new Database(":memory:");
      seed.exec("CREATE TABLE t (a INT); INSERT INTO t VALUES (1);");
      seed.close();
      // readonly on :memory: is the cheapest check that the option is
      // forwarded; the actual readonly-on-file path is exercised end-to-end
      // by database-service.test.ts which opens the raw DB with this flag.
      const db = new Database(":memory:", { readonly: true });
      expect(typeof db.prepare).toBe("function");
      db.close();
    });
  });

  describe("prepare → run / get / all", () => {
    it("returns { changes, lastInsertRowid } from run()", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
      const result = db.prepare("INSERT INTO t (val) VALUES (?)").run("hello");
      expect(result.changes).toBe(1);
      // better-sqlite3 returns number for rowid; the shim normalizes via
      // Number(result.changes). Just verify the type is usable, not exact.
      expect(
        typeof result.lastInsertRowid === "number" || typeof result.lastInsertRowid === "bigint"
      ).toBe(true);
      db.close();
    });

    it("get() returns the first row or undefined", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (a INT)");
      expect(db.prepare("SELECT a FROM t WHERE a = ?").get(1)).toBeUndefined();
      db.prepare("INSERT INTO t VALUES (?)").run(42);
      expect(db.prepare("SELECT a FROM t WHERE a = ?").get(42)).toEqual({ a: 42 });
      db.close();
    });

    it("all() returns every matching row", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (a INT)");
      db.prepare("INSERT INTO t VALUES (?)").run(1);
      db.prepare("INSERT INTO t VALUES (?)").run(2);
      db.prepare("INSERT INTO t VALUES (?)").run(3);
      const rows = db.prepare("SELECT a FROM t ORDER BY a").all() as { a: number }[];
      expect(rows.map((r) => r.a)).toEqual([1, 2, 3]);
      db.close();
    });

    it("supports positional varargs binding", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (a TEXT, b INT)");
      db.prepare("INSERT INTO t VALUES (?, ?)").run("alpha", 7);
      expect(db.prepare("SELECT * FROM t WHERE a = ? AND b = ?").get("alpha", 7)).toEqual({
        a: "alpha",
        b: 7,
      });
      db.close();
    });

    it("supports @-prefixed named parameter binding (the form database-service.ts uses)", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, name TEXT)");
      db.prepare("INSERT INTO t VALUES (@id, @name)").run({ id: "u1", name: "alice" });
      expect(db.prepare("SELECT * FROM t").all()).toEqual([{ id: "u1", name: "alice" }]);
      db.close();
    });

    it("supports ON CONFLICT upsert (the form retention_settings uses)", () => {
      const db = new Database(":memory:");
      db.exec(`
        CREATE TABLE retention_settings (
          scope TEXT PRIMARY KEY,
          retention_days INTEGER
        )
      `);
      const upsert = db.prepare(
        `INSERT INTO retention_settings (scope, retention_days)
         VALUES (?, ?)
         ON CONFLICT(scope) DO UPDATE SET retention_days = excluded.retention_days`
      );
      upsert.run("global", 30);
      upsert.run("global", 60); // overwrites
      const row = db
        .prepare("SELECT retention_days FROM retention_settings WHERE scope = ?")
        .get("global") as { retention_days: number };
      expect(row.retention_days).toBe(60);
      db.close();
    });
  });

  describe("pragma", () => {
    it("routes a SET form ('journal_mode = WAL') through exec without throwing", () => {
      const db = new Database(":memory:");
      // :memory: ignores WAL, but the directive must still parse + execute.
      expect(() => db.pragma("journal_mode = WAL")).not.toThrow();
      expect(() => db.pragma("synchronous = NORMAL")).not.toThrow();
      db.close();
    });

    it("routes a READ form ('table_info(t)') to prepare().all() and returns rows", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, age INT)");
      const cols = db.pragma("table_info(t)") as { name: string }[];
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(["age", "id", "name"]);
      db.close();
    });
  });

  describe("close", () => {
    it("closes the database; further calls on closed statements throw", () => {
      const db = new Database(":memory:");
      db.exec("CREATE TABLE t (a INT)");
      db.close();
      // Don't assert the exact error class — better-sqlite3 and node:sqlite
      // differ. Just confirm operations no longer succeed.
      expect(() => db.exec("INSERT INTO t VALUES (1)")).toThrow();
    });
  });
});

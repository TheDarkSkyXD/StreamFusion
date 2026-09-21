import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  createSavepointName,
  runSavepointTransaction,
} from "../adapters/sqlite-transaction";

function execSql(database: DatabaseSync): (source: string) => Promise<void> {
  return async (source) => {
    database.exec(source);
  };
}

function createItemsDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
  return database;
}

function itemRows(
  database: DatabaseSync,
): readonly { readonly name: string }[] {
  return database.prepare("SELECT name FROM items").all() as {
    readonly name: string;
  }[];
}

// Guards: nested BEGIN fails on an open SQLite transaction; savepoints still commit or roll back
describe("sqlite savepoint transactions", () => {
  it("rejects a nested BEGIN after an open transaction", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("BEGIN");
      expect(() => database.exec("BEGIN")).toThrow(/within a transaction/i);
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  });

  it("commits work that runs after an already-open BEGIN", async () => {
    const database = createItemsDatabase();
    try {
      database.exec("BEGIN");
      await runSavepointTransaction(
        execSql(database),
        async () => {
          database.exec("INSERT INTO items (name) VALUES ('kept')");
        },
        createSavepointName(1, 0.5),
      );
      database.exec("COMMIT");
      expect(itemRows(database)).toEqual([{ name: "kept" }]);
    } finally {
      database.close();
    }
  });

  it("rolls nested work back without leaving the outer transaction", async () => {
    const database = createItemsDatabase();
    try {
      database.exec("BEGIN");
      database.exec("INSERT INTO items (name) VALUES ('outer')");
      await expect(
        runSavepointTransaction(execSql(database), async () => {
          database.exec("INSERT INTO items (name) VALUES ('inner')");
          throw new Error("migration failed");
        }),
      ).rejects.toThrow(/migration failed/);
      expect(itemRows(database)).toEqual([{ name: "outer" }]);
      database.exec("COMMIT");
      expect(itemRows(database)).toEqual([{ name: "outer" }]);
    } finally {
      database.close();
    }
  });
});

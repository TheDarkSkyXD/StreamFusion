import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  databaseExists: vi.fn(() => true),
  randomBytes: vi.fn(() => "ab".repeat(32)),
  randomUuid: vi.fn(() => "12345678-1234-4234-8234-123456789abc"),
  openDatabase: vi.fn(async () => ({ handle: 7, path: "/data/user/0/app/files/SQLite/product.db", cipherVersion: "4.19.0" })),
  execute: vi.fn(async () => undefined),
  query: vi.fn(async () => [{ value: "kept" }]),
  run: vi.fn(async () => ({ changes: 1, lastInsertRowId: 2 })),
  closeDatabase: vi.fn(async () => undefined),
  backupDatabase: vi.fn(async () => undefined),
  restoreDatabase: vi.fn(async () => undefined),
  databaseAppearsEncrypted: vi.fn(async () => true),
  databaseContainsBytes: vi.fn(async () => false),
  corruptDatabase: vi.fn(async () => undefined),
  deleteDatabase: vi.fn(async () => undefined),
  deleteQuarantines: vi.fn(async () => undefined),
  quarantineDatabase: vi.fn(async () => "file:///data/user/0/app/files/recovery/product.db.1.quarantine"),
  cipherVersion: vi.fn(async () => "4.19.0"),
  secretGet: vi.fn(async () => "stored"),
  secretSet: vi.fn(async () => undefined),
  secretDelete: vi.fn(async () => undefined),
  secretIsAvailable: vi.fn(async () => true),
}));

vi.mock("react-native", () => ({ NativeModules: { StreamFusionStorage: native } }));

import { createAndroidSecureRandomSource } from "../adapters/android-secure-random-source";
import { createAndroidSecureSecretStore } from "../adapters/android-secure-secret-store";
import { createSqliteEncryptedDatabaseDriver } from "../adapters/sqlite-encrypted-driver";

beforeEach(() => vi.clearAllMocks());

describe("native storage adapters", () => {
  it("uses native random bytes and UUIDs", async () => {
    const random = createAndroidSecureRandomSource();
    expect(await random.databaseKey()).toBe("ab".repeat(32));
    expect(random.uuid()).toBe("12345678123442348234123456789abc");
  });

  it("uses the existing secure credential keys", async () => {
    const secrets = createAndroidSecureSecretStore();
    await secrets.set("product-key", "value");
    expect(await secrets.get("product-key")).toBe("stored");
    await secrets.delete("product-key");
    expect(native.secretSet).toHaveBeenCalledWith("product-key", "value");
    expect(native.secretGet).toHaveBeenCalledWith("product-key");
    expect(native.secretDelete).toHaveBeenCalledWith("product-key");
  });

  it("opens keyed databases and backs up with an independent key", async () => {
    const driver = createSqliteEncryptedDatabaseDriver();
    const source = await driver.open("product.db", "a".repeat(64));
    expect(source.path).toBe("/data/user/0/app/files/SQLite/product.db");
    expect(await source.first<{ value: string }>("SELECT value FROM settings")).toEqual({ value: "kept" });
    expect(await source.run("INSERT INTO settings (value) VALUES (?)", ["kept"])).toEqual({ changes: 1, lastInsertRowId: 2 });
    await driver.backup(source, "backup.db", "b".repeat(64));
    expect(native.backupDatabase).toHaveBeenCalledWith(7, "backup.db", "b".repeat(64));
    await source.close();
  });

  it("passes binary parameters without changing their bytes", async () => {
    const source = await createSqliteEncryptedDatabaseDriver().openUnencrypted("plain.db");
    await source.run("INSERT INTO blobs VALUES (?)", [new Uint8Array([0, 255])]);
    expect(native.run).toHaveBeenCalledWith(7, "INSERT INTO blobs VALUES (?)", [{ kind: "blob", base64: "AP8=" }]);
  });

  it("returns binary columns as bytes", async () => {
    native.query.mockResolvedValueOnce([{ payload: { kind: "blob", base64: "AP8=" } }]);
    const source = await createSqliteEncryptedDatabaseDriver().openUnencrypted("plain.db");
    expect(await source.first<{ payload: Uint8Array }>("SELECT payload FROM blobs")).toEqual({
      payload: new Uint8Array([0, 255]),
    });
  });

  it("keeps outside writes behind a savepoint transaction", async () => {
    const calls: string[] = [];
    native.execute.mockImplementation(async (_handle, source: string) => { calls.push(source); });
    native.run.mockImplementation(async (_handle, source: string) => {
      calls.push(source);
      return { changes: 1, lastInsertRowId: 2 };
    });
    const database = await createSqliteEncryptedDatabaseDriver().open("product.db", "a".repeat(64));
    const transaction = database.transaction(async (inside) => {
      await inside.run("INSERT INTO items VALUES (1)");
      await inside.run("INSERT INTO items VALUES (2)");
    });
    const outside = database.run("INSERT INTO items VALUES (3)");
    await Promise.all([transaction, outside]);
    expect(calls[0]).toMatch(/^SAVEPOINT /u);
    expect(calls.slice(1, 4)).toEqual([
      "INSERT INTO items VALUES (1)",
      "INSERT INTO items VALUES (2)",
      expect.stringMatching(/^RELEASE /u),
    ]);
    expect(calls[4]).toBe("INSERT INTO items VALUES (3)");
  });
});

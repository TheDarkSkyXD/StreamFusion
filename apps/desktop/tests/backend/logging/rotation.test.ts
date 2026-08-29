import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pruneLogs } from "@backend/logging/rotation";

// Per-test temp directory pattern mirrors apps/desktop/tests/backend/services/database-service.test.ts —
// each suite gets an isolated logs dir so file lists don't bleed between tests.
let tmpDir = "";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "streamfusion-rotation-test-"));
}

async function writeFileWithMtime(filePath: string, body: string, mtime: Date): Promise<void> {
  await fsp.writeFile(filePath, body, "utf8");
  await fsp.utimes(filePath, mtime, mtime);
}

beforeEach(() => {
  tmpDir = makeTmpDir();
});

afterEach(() => {
  // Best-effort cleanup. On Windows the OS may briefly hold a handle —
  // matches the pattern used by database-service.test.ts.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("pruneLogs — directory bootstrapping", () => {
  it("returns empty kept/pruned when the directory is empty", async () => {
    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 10 });

    expect(result.kept).toEqual([]);
    expect(result.pruned).toEqual([]);
  });

  it("creates the directory recursively when it does not yet exist", async () => {
    // Caller (main process) hands us a fresh userData/logs path on first boot.
    const nestedDir = path.join(tmpDir, "deep", "nested", "logs");
    expect(fs.existsSync(nestedDir)).toBe(false);

    const result = await pruneLogs(nestedDir, { prefix: "streamfusion-", keep: 10 });

    expect(fs.existsSync(nestedDir)).toBe(true);
    expect(result.kept).toEqual([]);
    expect(result.pruned).toEqual([]);
  });
});

describe("pruneLogs — keep-count semantics", () => {
  it("keeps everything when file count equals keep — nothing pruned", async () => {
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    const names = [
      "streamfusion-2026-06-01T00-00-00-000Z.log",
      "streamfusion-2026-06-02T00-00-00-000Z.log",
      "streamfusion-2026-06-03T00-00-00-000Z.log",
    ];
    for (let i = 0; i < names.length; i++) {
      await writeFileWithMtime(path.join(tmpDir, names[i]), "x", new Date(base + i * 1000));
    }

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 3 });

    expect(result.kept.map((p) => path.basename(p)).sort()).toEqual([...names].sort());
    expect(result.pruned).toEqual([]);
    // Every file is still on disk.
    for (const name of names) {
      expect(fs.existsSync(path.join(tmpDir, name))).toBe(true);
    }
  });

  it("keeps newest `keep` by mtime descending and prunes the rest", async () => {
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    const names = [
      "streamfusion-2026-06-01T00-00-00-000Z.log", // oldest
      "streamfusion-2026-06-02T00-00-00-000Z.log",
      "streamfusion-2026-06-03T00-00-00-000Z.log",
      "streamfusion-2026-06-04T00-00-00-000Z.log",
      "streamfusion-2026-06-05T00-00-00-000Z.log", // newest
    ];
    for (let i = 0; i < names.length; i++) {
      await writeFileWithMtime(path.join(tmpDir, names[i]), "x", new Date(base + i * 1000));
    }

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 2 });

    // Newest two kept, ordered newest -> oldest.
    expect(result.kept.map((p) => path.basename(p))).toEqual([
      "streamfusion-2026-06-05T00-00-00-000Z.log",
      "streamfusion-2026-06-04T00-00-00-000Z.log",
    ]);
    expect(result.pruned.map((p) => path.basename(p)).sort()).toEqual([
      "streamfusion-2026-06-01T00-00-00-000Z.log",
      "streamfusion-2026-06-02T00-00-00-000Z.log",
      "streamfusion-2026-06-03T00-00-00-000Z.log",
    ]);
    // Verify on disk.
    expect(fs.existsSync(path.join(tmpDir, "streamfusion-2026-06-05T00-00-00-000Z.log"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(tmpDir, "streamfusion-2026-06-04T00-00-00-000Z.log"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(tmpDir, "streamfusion-2026-06-03T00-00-00-000Z.log"))).toBe(
      false
    );
    expect(fs.existsSync(path.join(tmpDir, "streamfusion-2026-06-02T00-00-00-000Z.log"))).toBe(
      false
    );
    expect(fs.existsSync(path.join(tmpDir, "streamfusion-2026-06-01T00-00-00-000Z.log"))).toBe(
      false
    );
  });

  it("keep=0 prunes every matching file", async () => {
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    const names = [
      "streamfusion-2026-06-01T00-00-00-000Z.log",
      "streamfusion-2026-06-02T00-00-00-000Z.log",
    ];
    for (let i = 0; i < names.length; i++) {
      await writeFileWithMtime(path.join(tmpDir, names[i]), "x", new Date(base + i * 1000));
    }

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 0 });

    expect(result.kept).toEqual([]);
    expect(result.pruned.map((p) => path.basename(p)).sort()).toEqual([...names].sort());
    for (const name of names) {
      expect(fs.existsSync(path.join(tmpDir, name))).toBe(false);
    }
  });

  it("throws RangeError when keep is negative", async () => {
    await expect(pruneLogs(tmpDir, { prefix: "streamfusion-", keep: -1 })).rejects.toThrow(
      RangeError
    );
    await expect(pruneLogs(tmpDir, { prefix: "streamfusion-", keep: -1 })).rejects.toThrow(
      "keep must be >= 0"
    );
  });
});

describe("pruneLogs — filename filtering", () => {
  it("ignores files that do not match the prefix entirely", async () => {
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    await writeFileWithMtime(
      path.join(tmpDir, "streamfusion-2026-06-01T00-00-00-000Z.log"),
      "x",
      new Date(base)
    );
    // Non-matching files — different prefix, no prefix, or unrelated name.
    await writeFileWithMtime(path.join(tmpDir, "other-log.log"), "x", new Date(base));
    await writeFileWithMtime(path.join(tmpDir, "notes.txt"), "x", new Date(base));
    await writeFileWithMtime(path.join(tmpDir, "random.log"), "x", new Date(base));

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 0 });

    // Only the matching file shows up in pruned; non-matching are untouched.
    expect(result.pruned.map((p) => path.basename(p))).toEqual([
      "streamfusion-2026-06-01T00-00-00-000Z.log",
    ]);
    expect(result.kept).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, "other-log.log"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "notes.txt"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "random.log"))).toBe(true);
  });

  it("ignores files with the right prefix but wrong extension (.txt, .log.gz)", async () => {
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    await writeFileWithMtime(
      path.join(tmpDir, "streamfusion-2026-06-01T00-00-00-000Z.log"),
      "x",
      new Date(base)
    );
    await writeFileWithMtime(
      path.join(tmpDir, "streamfusion-2026-06-01T00-00-00-000Z.txt"),
      "x",
      new Date(base)
    );
    await writeFileWithMtime(
      path.join(tmpDir, "streamfusion-2026-06-01T00-00-00-000Z.log.gz"),
      "x",
      new Date(base)
    );

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 0 });

    expect(result.pruned.map((p) => path.basename(p))).toEqual([
      "streamfusion-2026-06-01T00-00-00-000Z.log",
    ]);
    // The .txt and .log.gz siblings survive — they are out of scope.
    expect(fs.existsSync(path.join(tmpDir, "streamfusion-2026-06-01T00-00-00-000Z.txt"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(tmpDir, "streamfusion-2026-06-01T00-00-00-000Z.log.gz"))).toBe(
      true
    );
  });

  it("a more-specific prefix scopes the prune strictly to files matching that prefix", async () => {
    // The production sinks use disambiguating prefixes ("streamfusion-" main
    // session log; "streamfusion-noise-" side-channel) and the caller is
    // expected to pass the exact prefix for each sink. Verify that pruning
    // the more-specific noise prefix touches ONLY noise files — the main
    // session files (which happen to share the "streamfusion-" stem) survive.
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    const mainNames = [
      "streamfusion-2026-06-01T00-00-00-000Z.log",
      "streamfusion-2026-06-02T00-00-00-000Z.log",
      "streamfusion-2026-06-03T00-00-00-000Z.log",
    ];
    const noiseNames = [
      "streamfusion-noise-2026-06-01T00-00-00-000Z.log",
      "streamfusion-noise-2026-06-02T00-00-00-000Z.log",
      "streamfusion-noise-2026-06-03T00-00-00-000Z.log",
    ];
    for (let i = 0; i < mainNames.length; i++) {
      await writeFileWithMtime(path.join(tmpDir, mainNames[i]), "x", new Date(base + i * 1000));
    }
    for (let i = 0; i < noiseNames.length; i++) {
      await writeFileWithMtime(path.join(tmpDir, noiseNames[i]), "x", new Date(base + i * 1000));
    }

    const noiseResult = await pruneLogs(tmpDir, { prefix: "streamfusion-noise-", keep: 1 });

    // Newest noise file kept, the other two noise files pruned. No main files touched.
    expect(noiseResult.kept.map((p) => path.basename(p))).toEqual([
      "streamfusion-noise-2026-06-03T00-00-00-000Z.log",
    ]);
    expect(noiseResult.pruned.map((p) => path.basename(p)).sort()).toEqual([
      "streamfusion-noise-2026-06-01T00-00-00-000Z.log",
      "streamfusion-noise-2026-06-02T00-00-00-000Z.log",
    ]);

    // All main-session files untouched.
    for (const name of mainNames) {
      expect(fs.existsSync(path.join(tmpDir, name))).toBe(true);
    }
  });
});

describe("pruneLogs — ordering and edge cases", () => {
  it("uses mtime descending to pick survivors, not filename order", async () => {
    // Filenames are intentionally REVERSED lexically vs. mtime order so a
    // basename-sort implementation would keep the wrong files.
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    const aPath = path.join(tmpDir, "streamfusion-AAA.log");
    const bPath = path.join(tmpDir, "streamfusion-BBB.log");
    const cPath = path.join(tmpDir, "streamfusion-CCC.log");
    await writeFileWithMtime(aPath, "x", new Date(base + 3000)); // newest by mtime
    await writeFileWithMtime(bPath, "x", new Date(base + 2000));
    await writeFileWithMtime(cPath, "x", new Date(base + 1000)); // oldest by mtime

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 1 });

    // mtime ordering wins — AAA (newest mtime) is the survivor even though
    // CCC sorts last lexically.
    expect(result.kept.map((p) => path.basename(p))).toEqual(["streamfusion-AAA.log"]);
    expect(result.pruned.map((p) => path.basename(p)).sort()).toEqual([
      "streamfusion-BBB.log",
      "streamfusion-CCC.log",
    ]);
  });

  it("falls back to descending basename order when two files share an identical mtime", async () => {
    // ISO-timestamped filenames sort lexically the same as chronologically,
    // so descending basename = newest first when mtimes tie.
    const sharedMtime = new Date("2026-06-01T12:00:00.000Z");
    const older = "streamfusion-2026-06-01T00-00-00-000Z.log";
    const middle = "streamfusion-2026-06-02T00-00-00-000Z.log";
    const newer = "streamfusion-2026-06-03T00-00-00-000Z.log";
    await writeFileWithMtime(path.join(tmpDir, older), "x", sharedMtime);
    await writeFileWithMtime(path.join(tmpDir, middle), "x", sharedMtime);
    await writeFileWithMtime(path.join(tmpDir, newer), "x", sharedMtime);

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 1 });

    // Descending basename tiebreak picks the lexically-largest filename.
    expect(result.kept.map((p) => path.basename(p))).toEqual([newer]);
    expect(result.pruned.map((p) => path.basename(p)).sort()).toEqual([middle, older].sort());
  });

  it("returns absolute paths in kept and pruned", async () => {
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    const name = "streamfusion-2026-06-01T00-00-00-000Z.log";
    await writeFileWithMtime(path.join(tmpDir, name), "x", new Date(base));
    const olderName = "streamfusion-2026-05-01T00-00-00-000Z.log";
    await writeFileWithMtime(path.join(tmpDir, olderName), "x", new Date(base - 86_400_000));

    const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 1 });

    for (const p of [...result.kept, ...result.pruned]) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });

  it("does not throw and skips a file when its unlink fails — survivor is NOT included in pruned", async () => {
    // Force unlink to fail for one specific file and succeed otherwise. We
    // assert that pruneLogs swallows the error, logs a warn, and reports only
    // the files that were actually deleted under `pruned`.
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    const stubbornName = "streamfusion-stubborn.log";
    const okName = "streamfusion-deletable.log";
    const newestName = "streamfusion-newest.log";
    await writeFileWithMtime(path.join(tmpDir, stubbornName), "x", new Date(base + 1000));
    await writeFileWithMtime(path.join(tmpDir, okName), "x", new Date(base + 2000));
    await writeFileWithMtime(path.join(tmpDir, newestName), "x", new Date(base + 9000));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const realUnlink = fsp.unlink;
    const unlinkSpy = vi.spyOn(fsp, "unlink").mockImplementation(async (target) => {
      if (typeof target === "string" && target.endsWith(stubbornName)) {
        throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      }
      return realUnlink(target);
    });

    try {
      const result = await pruneLogs(tmpDir, { prefix: "streamfusion-", keep: 1 });

      // newest survived as the kept file.
      expect(result.kept.map((p) => path.basename(p))).toEqual([newestName]);
      // okName was successfully deleted; stubbornName failed and is NOT in pruned.
      expect(result.pruned.map((p) => path.basename(p))).toEqual([okName]);
      // Stubborn file is still on disk.
      expect(fs.existsSync(path.join(tmpDir, stubbornName))).toBe(true);
      // Warning was emitted (we don't pin the message wording).
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      unlinkSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

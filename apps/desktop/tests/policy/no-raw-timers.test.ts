import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.resolve(__dirname, "../../src");

/**
 * Files where every raw setTimeout/setInterval is sanctioned:
 *   - the sanctioned helper utilities themselves
 *   - dev-only tooling
 *   - the WIP-deferred Settings page (see DEFERRED note)
 *
 * Paths are relative to apps/desktop/src/, forward slashes.
 */
const SANCTIONED_FILES = new Set<string>([
  // sanctioned helpers (SP1/SP2/SP3) — these ARE the wrappers
  "shared/utils/sleep.ts",
  "shared/utils/managed-interval.ts",
  // scheduler util (requestIdleCallback polyfill + delayed-task scheduler)
  "frontend/lib/idle-scheduler.ts",
  "frontend/hooks/useDebounce.ts",
  "frontend/hooks/useInterval.ts",
  "frontend/hooks/useTimeout.ts",
  "frontend/hooks/useManagedTimeout.ts",
  "backend/services/web-contents-ready.ts",
  // dev-only tooling (out of scope per SP2 O5)
  "frontend/components/dev/PerfTool.tsx",
  "frontend/components/dev/interval-tracker.ts",
  // DEFERRED until the user's WIP on this file lands; then tag the :380
  // auto-dismiss setTimeout with an inline `// timer-allowlist: <reason>`
  // marker (or migrate it to useTimeout from @/hooks/useTimeout, since
  // SP2's hook is now available) and remove this entry.
  "frontend/pages/Settings/index.tsx",
]);

const TIMER_CALL = /\b(setTimeout|setInterval)\s*\(/;
const ALLOW_MARKER = /\/\/\s*timer-allowlist\b/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function relSrc(file: string): string {
  return path.relative(SRC_DIR, file).split(path.sep).join("/");
}

interface Violation {
  file: string;
  line: number;
  source: string;
}

function findViolations(filePath: string, content: string): Violation[] {
  const rel = relSrc(filePath);
  const violations: Violation[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!TIMER_CALL.test(lines[i])) continue;
    const sameLine = lines[i];
    const prevLine = i > 0 ? lines[i - 1] : "";
    if (ALLOW_MARKER.test(sameLine) || ALLOW_MARKER.test(prevLine)) continue;
    violations.push({ file: rel, line: i + 1, source: sameLine.trim() });
  }
  return violations;
}

describe("policy: no raw setTimeout/setInterval outside sanctioned helpers", () => {
  // --- Self-tests: verify the matcher itself with small fixtures (no file I/O). ---
  describe("findViolations (fixture-based self-tests)", () => {
    const FIXTURE_PATH = "/fake/src/a.ts";

    it("flags a raw setTimeout call with no marker", () => {
      const src = "setTimeout(() => doX(), 100);\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(1);
    });

    it("accepts setTimeout with `// timer-allowlist: <reason>` on the same line", () => {
      const src = "setTimeout(() => doX(), 100); // timer-allowlist: reason\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(0);
    });

    it("accepts setTimeout with `// timer-allowlist:` on the previous line", () => {
      const src = "// timer-allowlist: reason\nsetTimeout(() => doX(), 100);\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(0);
    });

    it("ignores type references like `ReturnType<typeof setTimeout>`", () => {
      const src = "let t: ReturnType<typeof setTimeout> | null = null;\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(0);
    });

    it("flags setInterval the same as setTimeout", () => {
      const src = "setInterval(() => tick(), 1000);\n";
      expect(findViolations(FIXTURE_PATH, src)).toHaveLength(1);
    });
  });

  // --- The actual enforcement: scan all of src/. Fails with a full list. ---
  it("src/ has no raw timer calls outside sanctioned files or allowlist markers", () => {
    const violations: Violation[] = [];
    for (const file of walk(SRC_DIR)) {
      const rel = relSrc(file);
      if (SANCTIONED_FILES.has(rel)) continue;
      const content = fs.readFileSync(file, "utf8");
      violations.push(...findViolations(file, content));
    }
    if (violations.length === 0) return;
    const message = [
      "Raw setTimeout/setInterval without `// timer-allowlist: <reason>`:",
      ...violations.map((v) => `  src/${v.file}:${v.line}: ${v.source}`),
      "",
      "Fix: route the timer through one of the sanctioned helpers:",
      "  - @shared/utils/sleep            for async backoff (await sleep(ms))",
      "  - @shared/utils/managed-interval for recurring intervals",
      "  - @/hooks/useInterval         for React recurring intervals",
      "  - @/hooks/useTimeout          for React declarative one-shots",
      "  - @/hooks/useManagedTimeout   for React imperative one-shots",
      "  - AbortSignal.timeout(ms)     for fetch deadlines",
      "OR if the raw timer is intentional, add a marker on the same or prior line:",
      "  // timer-allowlist: <reason>",
    ].join("\n");
    throw new Error(message);
  });
});

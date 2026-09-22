import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/watch-recent-list.tsx", import.meta.url)),
  "utf8",
);

describe("WatchRecentList Continue Watching shelf", () => {
  it("labels the shelf Continue Watching and uses Resume when possible", () => {
    expect(source).toContain("Continue Watching");
    expect(source).toContain("canResumeWatchHistory");
    expect(source).toContain('canResume ? "Resume" : "Open"');
    expect(source).toContain("watchTargetFromHistory");
  });

  it("keeps Start watching rules by never autoplaying from the shelf", () => {
    expect(source).toContain("Playback never autoplays");
    expect(source).toContain("impactHaptic");
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/watch-recent-list.tsx", import.meta.url)),
  "utf8",
);

describe("WatchRecentList Continue Watching shelf", () => {
  it("labels the shelf Continue Watching and uses Resume when possible", () => {
    expect(source).toContain("playback.watch.continueWatching");
    expect(source).toContain("canResumeWatchHistory");
    expect(source).toContain("mediaLibrary.resume");
    expect(source).toContain("mediaLibrary.open");
    expect(source).toContain("watchTargetFromHistory");
  });

  it("keeps Start watching rules by never autoplaying from the shelf", () => {
    expect(source).toContain("playback.watch.continueWatchingCaption");
    expect(source).toContain("impactHaptic");
  });
});

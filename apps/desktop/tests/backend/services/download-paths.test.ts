import { describe, expect, it, vi } from "vitest";

import { buildDownloadFilename, getAvailableDestinationPath } from "@/backend/services/download-paths";

describe("download path helpers", () => {
  it("builds a safe username-title filename", () => {
    expect(buildDownloadFilename("fps/hero", "Ace: clutch? *final*", ".mp4")).toBe(
      "fpshero-Ace clutch final.mp4"
    );
  });

  it("auto-renames existing destination paths with numeric suffixes", () => {
    const exists = vi.fn((candidate: string) => candidate === "D:\\Videos\\fpshero-Ace.mp4");

    expect(getAvailableDestinationPath("D:\\Videos\\fpshero-Ace.mp4", exists)).toBe(
      "D:\\Videos\\fpshero-Ace (1).mp4"
    );
  });
});

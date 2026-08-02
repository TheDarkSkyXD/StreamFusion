import { describe, expect, it, vi } from "vitest";

import { resolveDefaultClipPlayback } from "@/backend/services/clip-download-default-service";

// Guards: renderer-provided Kick clip media is validated before privileged HTTP or FFmpeg use.
describe("default clip download playback resolution", () => {
  it("rejects untrusted Kick clip media before download execution", async () => {
    const twitchResolver = { getClipPlaybackUrl: vi.fn() };

    await expect(
      resolveDefaultClipPlayback(
        {
          platform: "kick",
          clipId: "clip-1",
          title: "Clip",
          channelName: "streamer",
          clipUrl: "http://127.0.0.1/private.mp4",
        },
        twitchResolver
      )
    ).rejects.toThrow("Untrusted Kick clip media URL");
    expect(twitchResolver.getClipPlaybackUrl).not.toHaveBeenCalled();
  });
});

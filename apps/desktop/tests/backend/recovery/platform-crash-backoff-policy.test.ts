import { describe, expect, it } from "vitest";

import { getPlatformCrashBackoffDecision } from "@backend/recovery/platform-crash-backoff-policy";

// Guards: AudioService utility crashes must not trip Kick/Twitch platform backoff or banner state.
// Guards: GPU and NetworkService crashes still give both platforms the short recovery backoff.
describe("getPlatformCrashBackoffDecision", () => {
  it("backs off both platforms for GPU crashes", () => {
    expect(getPlatformCrashBackoffDecision({ type: "GPU" })).toEqual({
      platforms: ["kick", "twitch"],
      reason: "gpu-process-gone",
    });
  });

  it("backs off both platforms for NetworkService utility crashes", () => {
    expect(
      getPlatformCrashBackoffDecision({
        type: "Utility",
        serviceName: "network.mojom.NetworkService",
        name: "Network Service",
      })
    ).toEqual({
      platforms: ["kick", "twitch"],
      reason: "network-service-gone",
    });
  });

  it("ignores AudioService utility crashes", () => {
    expect(
      getPlatformCrashBackoffDecision({
        type: "Utility",
        serviceName: "audio.mojom.AudioService",
        name: "Audio Service",
      })
    ).toBeNull();
  });
});

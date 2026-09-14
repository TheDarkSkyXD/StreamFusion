import { describe, expect, it } from "vitest";

import type { DiscoverySession } from "@mobile/features/discovery/capabilities/platform-reads";
import { fixtureChannel, fixtureChannelPage } from "@mobile/features/discovery/domain/channel-fixture";
import { fixtureStream } from "@mobile/features/discovery/domain/discovery-fixture";

import { createDiscoveryWatchInspectionReader } from "../adapters/discovery-watch-inspection-reader";

describe("discovery watch inspection reader", () => {
  it("keeps Info when Related is empty", async () => {
    const live = fixtureStream("twitch", "twitch-ready", 40);
    const session = {
      async readChannel() {
        return {
          ...fixtureChannelPage("twitch", "ready"),
          live: { ...live, categoryId: undefined },
        };
      },
      async readCategoryStreams() {
        return {
          cache: { kind: "miss" as const },
          items: [],
          path: { kind: "relay" as const, platform: "twitch" as const },
          platform: "twitch" as const,
          status: "complete" as const,
        };
      },
    } as unknown as DiscoverySession;
    const reader = createDiscoveryWatchInspectionReader(session);
    const inspection = await reader.read({
      signal: new AbortController().signal,
      target: {
        channelId: live.channelId,
        channelName: live.channelName,
        platform: "twitch",
      },
    });
    expect(inspection.info.kind).toBe("live");
    expect(inspection.related.kind).toBe("empty");
    expect(fixtureChannel("twitch", true).displayName).toBe("Twitch Live");
  });
});

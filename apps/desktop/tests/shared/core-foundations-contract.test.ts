import { describe, expect, it } from "vitest";

import type { Platform as CorePlatform } from "@streamfusion/core/platform";
import {
  channelsMatch as coreChannelsMatch,
  getChannelKey as coreGetChannelKey,
} from "@streamfusion/core/platform";
import { ok } from "@streamfusion/core/reliability";
import { platformFixtures, reliabilityFixtures } from "@streamfusion/core/testing";
import type { Platform as DesktopPlatform } from "@shared/auth-types";
import type { IpcReply, RetryAdvice, SafeAppError } from "@shared/reliability-types";
import {
  channelsMatch as desktopChannelsMatch,
  getChannelKey as desktopGetChannelKey,
} from "@/lib/id-utils";

// Guards: Desktop migration imports must resolve to the core identity implementation until C10 removes the compatibility exports.
// Guards: Desktop reliability aliases must preserve the existing IPC result and error contract during core extraction.
describe("shared-core foundation compatibility", () => {
  it("routes Desktop identity helpers through the core implementation", () => {
    expect(desktopChannelsMatch).toBe(coreChannelsMatch);
    expect(desktopGetChannelKey).toBe(coreGetChannelKey);
    expect(
      desktopChannelsMatch(
        platformFixtures.kickChannelByLegacyId,
        platformFixtures.kickChannelByOfficialId
      )
    ).toBe(true);
  });

  it("keeps the Desktop Platform alias identical to the core union", () => {
    const desktopPlatform: DesktopPlatform = platformFixtures.twitch;
    const corePlatform: CorePlatform = desktopPlatform;

    expect(corePlatform).toBe("twitch");
  });

  it("keeps existing IPC reliability names compatible with core results", () => {
    const retry: RetryAdvice = reliabilityFixtures.rateLimitedError.retry;
    const error: SafeAppError = reliabilityFixtures.rateLimitedError;
    const reply: IpcReply<string> = ok("ready");

    expect(retry).toEqual({ kind: "after", retryAtMs: 1_800_000_000_000 });
    expect(error.code).toBe("rate_limited");
    expect(reply).toEqual({ kind: "ok", value: "ready" });
  });
});

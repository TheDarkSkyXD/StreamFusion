import { describe, expect, it } from "vitest";

import {
  addMultistreamSlot,
  emptyMultistreamLayout,
  removeMultistreamSlot,
  reorderMultistreamSlot,
  setMultistreamAudioOwner,
  setMultistreamFocus,
  setMultistreamMode,
  slotFromWatchTarget,
} from "../domain/multistream-layout";
import {
  activeCapacityForStage,
  measureActiveVideoLimit,
  qualifyMultistream,
} from "../domain/multistream-admission";
import {
  composeMultistreamView,
  tabletMultistreamColumns,
} from "../domain/multistream-view";
import type { AndroidResourceSnapshot } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import { MAX_MULTISTREAM_SLOTS } from "../capabilities/multistream";

// Guards: Multistream keeps six configured slots and one audio owner
// Guards: measured active-video limits retain extra slots instead of dropping them
// Guards: duplicate live identity is rejected and reorder keeps typed identity

const twitch = slotFromWatchTarget({
  channelId: "71092938",
  channelName: "xqc",
  platform: "twitch",
});
const kick = slotFromWatchTarget({
  channelId: "123",
  channelName: "xqc",
  platform: "kick",
});

function snapshot(
  overrides: Partial<AndroidResourceSnapshot> = {},
): AndroidResourceSnapshot {
  return {
    decoders: [],
    memory: {
      availableBytes: 4_294_967_296,
      lowMemory: false,
      runtimeFreeBytes: 524_288_000,
      runtimeMaxBytes: 1_073_741_824,
      runtimeTotalBytes: 549_453_824,
      thresholdBytes: 268_435_456,
      totalBytes: 8_589_934_592,
    },
    observedAtEpochMs: 1,
    runtime: {
      apiLevel: 30,
      applicationId: "com.thedarkskyxd.streamfusion.dev",
      executionEnvironment: "emulator",
      formFactor: {
        automotive: false,
        pc: false,
        touchscreen: true,
        television: false,
        uiModeType: 1,
        watch: false,
      },
      supportedAbis: ["x86_64"],
      versionCode: 1,
    },
    storage: { availableBytes: 8_589_934_592, totalBytes: 17_179_869_184 },
    thermal: { kind: "observed", state: "none" },
    ...overrides,
  };
}

describe("multistream layout", () => {
  it("adds live identity, rejects duplicates, and caps at six slots", () => {
    const first = addMultistreamSlot(emptyMultistreamLayout(), twitch, 1);
    expect(first.kind).toBe("applied");
    if (first.kind !== "applied") return;
    expect(first.layout.audioOwnerId).toBe(twitch.id);
    expect(addMultistreamSlot(first.layout, twitch, 2).kind).toBe("rejected");
    let layout = first.layout;
    for (let index = 0; index < MAX_MULTISTREAM_SLOTS; index += 1) {
      const next = addMultistreamSlot(
        layout,
        slotFromWatchTarget({
          channelId: `channel-${index}`,
          channelName: `user${index}`,
          platform: "twitch",
        }),
        index + 2,
      );
      if (next.kind === "applied") layout = next.layout;
    }
    expect(layout.slots).toHaveLength(MAX_MULTISTREAM_SLOTS);
    expect(
      addMultistreamSlot(
        layout,
        slotFromWatchTarget({
          channelId: "overflow",
          channelName: "overflow",
          platform: "kick",
        }),
        99,
      ).kind,
    ).toBe("rejected");
  });

  it("honors a Settings slot cap below the hard maximum", () => {
    const first = addMultistreamSlot(emptyMultistreamLayout(), twitch, 1, 1);
    expect(first.kind).toBe("applied");
    if (first.kind !== "applied") return;
    expect(
      addMultistreamSlot(first.layout, kick, 2, 1).kind,
    ).toBe("rejected");
  });

  it("reorders, focuses, and moves audio ownership only for active slots", () => {
    const withTwitch = addMultistreamSlot(emptyMultistreamLayout(), twitch, 1);
    const withKick =
      withTwitch.kind === "applied"
        ? addMultistreamSlot(withTwitch.layout, kick, 2)
        : withTwitch;
    expect(withKick.kind).toBe("applied");
    if (withKick.kind !== "applied") return;
    const reordered = reorderMultistreamSlot(withKick.layout, kick.id, "up", 3);
    expect(reordered.slots.map((slot) => slot.id)).toEqual([kick.id, twitch.id]);
    const focused = setMultistreamFocus(reordered, twitch.id, 4);
    expect(focused.focusedSlotId).toBe(twitch.id);
    const audio = setMultistreamAudioOwner(
      focused,
      twitch.id,
      new Set([twitch.id]),
      5,
    );
    expect(audio.kind).toBe("applied");
    expect(
      setMultistreamAudioOwner(focused, kick.id, new Set([twitch.id]), 6).kind,
    ).toBe("rejected");
    expect(setMultistreamMode(focused, "focus", 7).mode).toBe("focus");
    expect(removeMultistreamSlot(focused, twitch.id, 8).slots).toHaveLength(1);
  });
});

describe("multistream admission", () => {
  it("measures software-only emulator capacity and retains extra slots", () => {
    const admission = measureActiveVideoLimit(snapshot());
    expect(admission.limit).toBe(2);
    expect(activeCapacityForStage(admission.limit, 0)).toBe(2);
    expect(activeCapacityForStage(admission.limit, 3)).toBe(1);
    const slots = [twitch, kick, slotFromWatchTarget({
      channelId: "3",
      channelName: "third",
      platform: "twitch",
    })];
    const layout = {
      audioOwnerId: kick.id,
      focusedSlotId: kick.id,
      mode: "grid" as const,
      slots,
      updatedAt: 1,
    };
    const healthy = qualifyMultistream({
      admission,
      layout,
      stage: 0,
    });
    expect(healthy.activeSlotIds).toEqual([kick.id, twitch.id]);
    expect(healthy.layout.audioOwnerId).toBe(kick.id);
    const thermal = qualifyMultistream({
      admission,
      layout,
      stage: 4,
    });
    expect(thermal.activeSlotIds).toEqual([kick.id]);
    expect(thermal.thumbnailSlotIds).toEqual([twitch.id, slots[2]?.id]);
    const view = composeMultistreamView({
      qualified: thermal,
      windowWidth: 411,
    });
    expect(view.configuredCount).toBe(3);
    expect(view.activeCount).toBe(1);
    expect(view.cells).toHaveLength(6);
    expect(view.title).toContain("3 configured");
    expect(view.notice).toContain("Stage 4");
    expect(view.chatDetail).toContain("Chat is not connected");
    expect(view.captionDetail).toContain("Local captions are not connected");
    expect(tabletMultistreamColumns(411)).toBe(1);
    expect(tabletMultistreamColumns(600)).toBe(2);
    expect(tabletMultistreamColumns(900)).toBe(3);
  });
});

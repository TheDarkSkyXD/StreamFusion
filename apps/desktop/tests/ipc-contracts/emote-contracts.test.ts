import { describe, expect, it } from "vitest";

import { emoteIpcContracts } from "@shared/ipc-contracts/emote-contracts";
import { IPC_CHANNELS } from "@shared/ipc-channels";

describe("emote IPC contracts", () => {
  const roomContract = emoteIpcContracts[IPC_CHANNELS.EMOTES_FFZ_GET_ROOM];

  it("requires exactly one FFZ room lookup strategy", () => {
    expect(roomContract.request.safeParse({ kind: "name", name: "xqc" }).success).toBe(true);
    expect(
      roomContract.request.safeParse({ kind: "channel-id", channelId: "71092938" }).success
    ).toBe(true);
    expect(roomContract.request.safeParse({}).success).toBe(false);
    expect(
      roomContract.request.safeParse({
        kind: "name",
        name: "xqc",
        channelId: "71092938",
      }).success
    ).toBe(false);
  });

  it("represents an expected missing provider account as a successful null", () => {
    const contract = emoteIpcContracts[IPC_CHANNELS.EMOTES_7TV_GET_USER_BY_CONNECTION];
    expect(contract.response.safeParse({ kind: "ok", value: null }).success).toBe(true);
  });
});

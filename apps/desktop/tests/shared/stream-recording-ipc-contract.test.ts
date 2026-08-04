import { describe, expect, expectTypeOf, it } from "vitest";

import { IPC_CHANNELS, type IpcPayloads } from "@/shared/ipc-channels";

describe("Stream Recording discard IPC contract", () => {
  it("uses a recording-scoped channel carrying only the authoritative session identity", () => {
    expect(IPC_CHANNELS.STREAM_RECORDING_DISCARD).toBe("stream-recording:discard");
    expectTypeOf<
      IpcPayloads[typeof IPC_CHANNELS.STREAM_RECORDING_DISCARD]
    >().toEqualTypeOf<{ sessionId: string }>();
  });
});

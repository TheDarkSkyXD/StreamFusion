import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../modules/streamfusion-native-contracts/src/storage", () => ({
  requireStorageModule: () => ({ randomBytes: (length: number) => "ab".repeat(length) }),
}));

import { createPayloadSecretBox } from "../adapters/payload-secretbox";

describe("payload secretbox", () => {
  it("round-trips sealed Product payloads", () => {
    const box = createPayloadSecretBox("a".repeat(64));
    const sealed = box.seal('{"key":"value"}');
    expect(sealed.startsWith("sf1:")).toBe(true);
    expect(box.open(sealed)).toBe('{"key":"value"}');
    expect(box.open("plain-legacy")).toBe("plain-legacy");
  });
});

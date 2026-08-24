import { describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: { warn: vi.fn() },
}));

import { readEmoteReply } from "@/backend/ipc/emote-ipc-reply";
import { BoundedReadError } from "@/backend/reliability/bounded-json-read";

describe("readEmoteReply", () => {
  it.each([
    ["canceled", "canceled"],
    ["timeout", "timeout"],
    ["response_too_large", "upstream_schema"],
    ["invalid_json", "upstream_schema"],
    ["upstream_schema", "upstream_schema"],
  ] as const)("maps %s into a safe %s result", async (source, expected) => {
    const result = await readEmoteReply("provider", async () => {
      throw new BoundedReadError(source, "private detail");
    });

    expect(result).toMatchObject({
      kind: "error",
      error: { code: expected, retry: expect.any(Object) },
    });
    if (result.kind === "error") {
      expect(result.error.diagnosticId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    }
  });

  it("keeps retryable upstream HTTP failures distinct", async () => {
    const result = await readEmoteReply("provider", async () => {
      throw new BoundedReadError("http", "private detail", 503);
    });

    expect(result).toMatchObject({
      kind: "error",
      error: { code: "transient", retry: { kind: "manual" } },
    });
  });
});

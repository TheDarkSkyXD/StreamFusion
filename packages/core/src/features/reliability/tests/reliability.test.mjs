import assert from "node:assert/strict";
import test from "node:test";

import { APP_ERROR_CODES, err, ok } from "@streamfusion/core/reliability";

test("portable results keep success and failure states disjoint", () => {
  assert.deepEqual(ok({ channelId: "42" }), {
    kind: "ok",
    value: { channelId: "42" },
  });

  const error = {
    code: "transient",
    retry: { kind: "after", retryAtMs: 1_800_000_000_000 },
    diagnosticId: "2efb4508-cf3c-440e-a05f-50b29fb60078",
    platform: "kick",
  };
  assert.deepEqual(err(error), { kind: "error", error });
});

test("portable error codes and retry decisions survive JSON serialization", () => {
  assert.deepEqual(APP_ERROR_CODES, [
    "invalid_input",
    "unauthenticated",
    "forbidden",
    "not_found",
    "conflict",
    "rate_limited",
    "transient",
    "timeout",
    "offline",
    "canceled",
    "corrupt_local_data",
    "upstream_schema",
    "internal",
  ]);

  const value = err({
    code: "rate_limited",
    retry: { kind: "manual" },
    diagnosticId: "bfbb7fa2-51cd-493e-86dc-ad98bd876e52",
    platform: "twitch",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
});

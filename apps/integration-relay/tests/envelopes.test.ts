import { describe, expect, it } from "vitest";

import {
  createRelayFailureEnvelope,
  relayErrorSchema,
  relayEventEnvelopeSchema,
  relayRequestEnvelopeSchema,
  relayResponseEnvelopeSchema,
  relayVersionEnvelopeSchema
} from "@streamfusion/core/relay";

describe("shared relay envelopes", () => {
  it("accepts serialization-safe request, response, and event envelopes", () => {
    const request = {
      protocolVersion: 1,
      kind: "request",
      requestId: "request-1",
      body: { channelId: "channel-1" }
    };
    const response = createRelayFailureEnvelope({
      requestId: request.requestId,
      error: { code: "unavailable", retry: { kind: "after", seconds: 30 } }
    });
    const event = {
      protocolVersion: 1,
      kind: "event",
      eventId: "event-1",
      eventType: "relay.test",
      occurredAt: "2026-08-30T00:00:00.000Z",
      body: null
    };

    expect(relayRequestEnvelopeSchema.is(request)).toBe(true);
    expect(relayVersionEnvelopeSchema.is(request)).toBe(true);
    expect(relayErrorSchema.is(response.outcome.error)).toBe(true);
    expect(relayResponseEnvelopeSchema.is(response)).toBe(true);
    expect(
      relayResponseEnvelopeSchema.is({
        protocolVersion: 1,
        kind: "response",
        requestId: "request-1",
        outcome: { kind: "success", body: ["ok"] }
      })
    ).toBe(true);
    expect(relayEventEnvelopeSchema.is(event)).toBe(true);
    expect(
      relayResponseEnvelopeSchema.is(JSON.parse(JSON.stringify(response)))
    ).toBe(true);
  });

  it("rejects unknown versions and non-JSON payloads", () => {
    expect(
      relayRequestEnvelopeSchema.is({
        protocolVersion: 2,
        kind: "request",
        requestId: "request-1",
        body: null
      })
    ).toBe(false);
    expect(
      relayRequestEnvelopeSchema.is({
        protocolVersion: 1,
        kind: "request",
        requestId: "request-1",
        body: { invalid: undefined }
      })
    ).toBe(false);
    expect(
      relayEventEnvelopeSchema.is({
        protocolVersion: 1,
        kind: "event",
        eventId: "event-1",
        eventType: "relay.test",
        occurredAt: "not-a-timestamp",
        body: null
      })
    ).toBe(false);
    expect(
      relayRequestEnvelopeSchema.is({
        protocolVersion: 1,
        kind: "request",
        requestId: "request-1",
        body: new Date()
      })
    ).toBe(false);
    expect(
      relayErrorSchema.is({
        code: "unavailable",
        retry: { kind: "after", seconds: 0 }
      })
    ).toBe(false);
    expect(() =>
      createRelayFailureEnvelope({
        requestId: "invalid request id",
        error: { code: "not_found", retry: { kind: "never" } }
      })
    ).toThrow(RangeError);
    const sparseBody: unknown[] = [];
    sparseBody.length = 1;
    expect(
      relayRequestEnvelopeSchema.is({
        protocolVersion: 1,
        kind: "request",
        requestId: "request-1",
        body: sparseBody
      })
    ).toBe(false);
  });
});

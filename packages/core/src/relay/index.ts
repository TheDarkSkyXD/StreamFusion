export const RELAY_PROTOCOL_VERSION = 1;

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type RelayVersionEnvelope = {
  readonly protocolVersion: typeof RELAY_PROTOCOL_VERSION;
};

export type RelayRequestEnvelope = RelayVersionEnvelope & {
  readonly kind: "request";
  readonly requestId: string;
  readonly body: JsonValue;
};

export type RelayRetry =
  | { readonly kind: "never" }
  | { readonly kind: "after"; readonly seconds: number };

export type RelayErrorCode =
  | "invalid_request"
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "internal_error";

export type RelayError = {
  readonly code: RelayErrorCode;
  readonly retry: RelayRetry;
};

export type RelaySuccessEnvelope = RelayVersionEnvelope & {
  readonly kind: "response";
  readonly requestId: string;
  readonly outcome: {
    readonly kind: "success";
    readonly body: JsonValue;
  };
};

export type RelayFailureEnvelope = RelayVersionEnvelope & {
  readonly kind: "response";
  readonly requestId: string | null;
  readonly outcome: {
    readonly kind: "failure";
    readonly error: RelayError;
  };
};

export type RelayResponseEnvelope = RelayFailureEnvelope | RelaySuccessEnvelope;

export type RelayEventEnvelope = RelayVersionEnvelope & {
  readonly kind: "event";
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly body: JsonValue;
};

export type RelayEnvelope =
  RelayEventEnvelope | RelayRequestEnvelope | RelayResponseEnvelope;

export type RelaySchema<TValue> = {
  is(value: unknown): value is TValue;
};

const RELAY_ERROR_CODES = {
  invalid_request: true,
  not_found: true,
  unauthorized: true,
  rate_limited: true,
  unavailable: true,
  internal_error: true,
} satisfies Record<RelayErrorCode, true>;

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_JSON_DEPTH = 32;

export const relayVersionEnvelopeSchema: RelaySchema<RelayVersionEnvelope> = {
  is: isRelayVersionEnvelope,
};

export const relayErrorSchema: RelaySchema<RelayError> = {
  is: isRelayError,
};

export const relayRequestEnvelopeSchema: RelaySchema<RelayRequestEnvelope> = {
  is: isRelayRequestEnvelope,
};

export const relayResponseEnvelopeSchema: RelaySchema<RelayResponseEnvelope> = {
  is: isRelayResponseEnvelope,
};

export const relayEventEnvelopeSchema: RelaySchema<RelayEventEnvelope> = {
  is: isRelayEventEnvelope,
};

export function createRelayFailureEnvelope(input: {
  readonly requestId: string | null;
  readonly error: RelayError;
}): RelayFailureEnvelope {
  if (
    (input.requestId !== null && !isIdentifier(input.requestId)) ||
    !isRelayError(input.error)
  ) {
    throw new RangeError("Invalid relay failure envelope");
  }

  return {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    kind: "response",
    requestId: input.requestId,
    outcome: {
      kind: "failure",
      error: input.error,
    },
  };
}

function isRelayRequestEnvelope(value: unknown): value is RelayRequestEnvelope {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["protocolVersion", "kind", "requestId", "body"]) &&
    value.protocolVersion === RELAY_PROTOCOL_VERSION &&
    value.kind === "request" &&
    isIdentifier(value.requestId) &&
    isJsonValue(value.body)
  );
}

function isRelayVersionEnvelope(value: unknown): value is RelayVersionEnvelope {
  return isRecord(value) && value.protocolVersion === RELAY_PROTOCOL_VERSION;
}

function isRelayResponseEnvelope(
  value: unknown,
): value is RelayResponseEnvelope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["protocolVersion", "kind", "requestId", "outcome"]) ||
    value.protocolVersion !== RELAY_PROTOCOL_VERSION ||
    value.kind !== "response" ||
    !isRecord(value.outcome)
  ) {
    return false;
  }

  if (value.outcome.kind === "success") {
    return (
      isIdentifier(value.requestId) &&
      hasExactKeys(value.outcome, ["kind", "body"]) &&
      isJsonValue(value.outcome.body)
    );
  }

  return (
    value.outcome.kind === "failure" &&
    (value.requestId === null || isIdentifier(value.requestId)) &&
    hasExactKeys(value.outcome, ["kind", "error"]) &&
    isRelayError(value.outcome.error)
  );
}

function isRelayEventEnvelope(value: unknown): value is RelayEventEnvelope {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "protocolVersion",
      "kind",
      "eventId",
      "eventType",
      "occurredAt",
      "body",
    ]) &&
    value.protocolVersion === RELAY_PROTOCOL_VERSION &&
    value.kind === "event" &&
    isIdentifier(value.eventId) &&
    isIdentifier(value.eventType) &&
    isIsoTimestamp(value.occurredAt) &&
    isJsonValue(value.body)
  );
}

function isRelayError(value: unknown): value is RelayError {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["code", "retry"]) &&
    isRelayErrorCode(value.code) &&
    isRelayRetry(value.retry)
  );
}

function isRelayRetry(value: unknown): value is RelayRetry {
  if (!isRecord(value)) return false;
  if (value.kind === "never") return hasExactKeys(value, ["kind"]);

  return (
    value.kind === "after" &&
    hasExactKeys(value, ["kind", "seconds"]) &&
    Number.isInteger(value.seconds) &&
    typeof value.seconds === "number" &&
    value.seconds > 0 &&
    value.seconds <= 86_400
  );
}

function isRelayErrorCode(value: unknown): value is RelayErrorCode {
  return typeof value === "string" && Object.hasOwn(RELAY_ERROR_CODES, value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return (
    !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value
  );
}

function isJsonValue(
  value: unknown,
  depth = 0,
  ancestors: ReadonlySet<object> = new Set(),
): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= MAX_JSON_DEPTH || typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);

  if (Array.isArray(value)) {
    return (
      Object.keys(value).length === value.length &&
      Object.getOwnPropertySymbols(value).length === 0 &&
      value.every((item) => isJsonValue(item, depth + 1, nextAncestors))
    );
  }

  return (
    isRecord(value) &&
    Object.values(value).every((item) =>
      isJsonValue(item, depth + 1, nextAncestors),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

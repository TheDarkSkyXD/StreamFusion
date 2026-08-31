import {
  createRelayFailureEnvelope,
  type RelayError,
  type RelayFailureEnvelope
} from "@streamfusion/core/relay";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff"
};

function createRelayErrorResponse(input: {
  readonly requestId: string;
  readonly error: RelayError;
  readonly status: number;
}): Response {
  const body: RelayFailureEnvelope = createRelayFailureEnvelope({
    requestId: input.requestId,
    error: input.error
  });

  return new Response(JSON.stringify(body), {
    status: input.status,
    headers: RESPONSE_HEADERS
  });
}

export function createRelayNotFoundResponse(requestId: string): Response {
  return createRelayErrorResponse({
    requestId,
    error: {
      code: "not_found",
      retry: { kind: "never" }
    },
    status: 404
  });
}

export function createRelayUnavailableResponse(requestId: string): Response {
  return createRelayErrorResponse({
    requestId,
    error: {
      code: "unavailable",
      retry: { kind: "after", seconds: 60 }
    },
    status: 503
  });
}

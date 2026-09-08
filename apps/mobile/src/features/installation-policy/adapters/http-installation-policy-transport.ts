import {
  installationCredentialGrantSchema,
  relayResponseEnvelopeSchema,
} from "@streamfusion/core/relay";

import type {
  InstallationPolicyTransport,
  InstallationPolicyTransportFailure,
  InstallationRegistrationResult,
} from "../capabilities/installation-policy";

export function createHttpInstallationPolicyTransport(input: {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): InstallationPolicyTransport {
  return {
    async readManifest({ credential, signal }) {
      const response = await request(input, "/v1/capability-manifest", {
        headers: { Authorization: `Bearer ${credential.credential}` },
        method: "GET",
        signal,
      });
      if (response.kind === "failure") return response;
      return { kind: "received", payload: response.body };
    },

    async register({
      credential,
      environment,
      installationId,
      registrationId,
      signal,
    }) {
      const response = await request(input, "/v1/installations/register", {
        body: JSON.stringify({ environment, installationId, registrationId }),
        headers: {
          ...(credential === null
            ? {}
            : { Authorization: `Bearer ${credential.credential}` }),
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      });
      return registrationResult(response, installationId);
    },

    async rotate({ credential, rotationId, signal }) {
      const response = await request(input, "/v1/installations/rotate", {
        body: JSON.stringify({ rotationId }),
        headers: {
          Authorization: `Bearer ${credential.credential}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      });
      return registrationResult(response, credential.installationId);
    },
  };
}

async function request(
  input: {
    readonly baseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly timeoutMs?: number;
  },
  path: string,
  init: RequestInit,
): Promise<
  | { readonly kind: "success"; readonly body: unknown }
  | {
      readonly kind: "failure";
      readonly failure: InstallationPolicyTransportFailure;
    }
> {
  if (init.signal?.aborted) {
    return { kind: "failure", failure: { kind: "cancelled" } };
  }
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, input.timeoutMs ?? 15_000);
  const abortFromCaller = () => timeoutController.abort();
  init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await input.fetch(new URL(path, input.baseUrl), {
      ...init,
      signal: timeoutController.signal,
    });
    const payload: unknown = await response.json();
    if (!relayResponseEnvelopeSchema.is(payload))
      return { kind: "failure", failure: { kind: "unavailable" } };
    if (!response.ok && payload.outcome.kind === "success") {
      return { kind: "failure", failure: { kind: "unavailable" } };
    }
    if (payload.outcome.kind === "success")
      return { kind: "success", body: payload.outcome.body };
    return {
      kind: "failure",
      failure: failureFromRelay(payload.outcome.error),
    };
  } catch (error) {
    if (init.signal?.aborted) {
      return { kind: "failure", failure: { kind: "cancelled" } };
    }
    if (timedOut) return { kind: "failure", failure: { kind: "unavailable" } };
    if (isAbortError(error))
      return { kind: "failure", failure: { kind: "cancelled" } };
    return { kind: "failure", failure: { kind: "offline" } };
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function registrationResult(
  response: Awaited<ReturnType<typeof request>>,
  installationId: string,
): InstallationRegistrationResult {
  if (response.kind === "failure") return response;
  if (!installationCredentialGrantSchema.is(response.body)) {
    return { kind: "failure", failure: { kind: "unavailable" } };
  }
  return {
    kind: "registered",
    credential: { ...response.body, installationId },
  };
}

function failureFromRelay(error: {
  readonly code: string;
  readonly retry:
    | { readonly kind: "after"; readonly seconds: number }
    | { readonly kind: "never" };
}): InstallationPolicyTransportFailure {
  if (error.code === "rate_limited" && error.retry.kind === "after") {
    return { kind: "rate-limited", retryAfterSeconds: error.retry.seconds };
  }
  if (error.code === "unauthorized") return { kind: "unauthorized" };
  return { kind: "unavailable" };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

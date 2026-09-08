import { describe, expect, it } from "vitest";

import { createHttpInstallationPolicyTransport } from "../adapters/http-installation-policy-transport";

const credential = {
  credential: `v1.${"A".repeat(43)}.${"B".repeat(43)}`,
  credentialExpiresAt: "2026-09-20T00:00:00.000Z",
  generation: 1,
  installationId: "de3c0860-7340-4f2d-b7bb-bc091f9150b0",
  reconciledAt: "2026-09-07T00:00:00.000Z",
};

describe("HTTP installation policy transport", () => {
  it("does not accept a success-shaped body from a non-success HTTP response", async () => {
    const transport = createHttpInstallationPolicyTransport({
      baseUrl: "https://relay.example/",
      fetch: async () =>
        new Response(
          JSON.stringify({
            kind: "response",
            outcome: {
              body: {
                credential: credential.credential,
                credentialExpiresAt: credential.credentialExpiresAt,
                generation: 1,
                reconciledAt: credential.reconciledAt,
              },
              kind: "success",
            },
            protocolVersion: 1,
            requestId: "request-95B4xv59NSmcKQz33cAj9g",
          }),
          { status: 503 },
        ),
    });

    await expect(
      transport.register({
        credential: null,
        environment: "development",
        installationId: credential.installationId,
        registrationId: "register-95B4xv59NSmcKQz33cAj9g",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "failure", failure: { kind: "unavailable" } });
  });

  it("reports aborted work as cancelled instead of offline", async () => {
    const transport = createHttpInstallationPolicyTransport({
      baseUrl: "https://relay.example/",
      fetch: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });

    await expect(
      transport.readManifest({
        credential,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "failure", failure: { kind: "cancelled" } });
  });

  it("reports an abort while reading the response body as cancelled", async () => {
    const abort = new AbortController();
    const transport = createHttpInstallationPolicyTransport({
      baseUrl: "https://relay.example/",
      fetch: async () =>
        ({
          json: async () => {
            abort.abort();
            throw new Error("body read stopped");
          },
          ok: true,
        }) as Response,
    });

    await expect(
      transport.readManifest({ credential, signal: abort.signal }),
    ).resolves.toEqual({ kind: "failure", failure: { kind: "cancelled" } });
  });

  it("turns its bounded request timeout into retryable unavailability", async () => {
    const transport = createHttpInstallationPolicyTransport({
      baseUrl: "https://relay.example/",
      fetch: async (_request, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              Object.assign(new Error("timed out"), { name: "AbortError" }),
            );
          });
        }),
      timeoutMs: 1,
    });

    await expect(
      transport.readManifest({
        credential,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "failure", failure: { kind: "unavailable" } });
  });

  it("does not start a request for an already-aborted caller signal", async () => {
    let requests = 0;
    const abort = new AbortController();
    abort.abort();
    const transport = createHttpInstallationPolicyTransport({
      baseUrl: "https://relay.example/",
      fetch: async () => {
        requests += 1;
        return new Response();
      },
    });

    await expect(
      transport.readManifest({ credential, signal: abort.signal }),
    ).resolves.toEqual({ kind: "failure", failure: { kind: "cancelled" } });
    expect(requests).toBe(0);
  });
});

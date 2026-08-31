import { describe, expect, it } from "vitest";

import worker from "../src/composition/worker.js";

describe("Integration Relay boundary", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/health"],
    ["POST", "/v1/installations"],
    ["GET", "/v1/discovery"]
  ])("exposes no product endpoint for %s %s", async (method, path) => {
    const response = await worker.fetch(
      new Request(`https://relay.example${path}`, { method }),
      { RELAY_ENVIRONMENT: "development" }
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      kind: "response",
      protocolVersion: 1,
      outcome: {
        kind: "failure",
        error: {
          code: "not_found",
          retry: { kind: "never" }
        }
      }
    });
  });

  it("fails closed when the deployment environment is absent", async () => {
    const response = await worker.fetch(new Request("https://relay.example/"), {
      RELAY_ENVIRONMENT: ""
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      kind: "response",
      protocolVersion: 1,
      outcome: {
        kind: "failure",
        error: {
          code: "unavailable",
          retry: { kind: "after", seconds: 60 }
        }
      }
    });
  });
});

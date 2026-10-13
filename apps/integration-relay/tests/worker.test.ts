import { afterEach, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

import worker from "../src/composition/worker.js";

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

describe("Integration Relay boundary", () => {
  it.each(["register", "disable"])(
    "does not serve the retired notification %s route",
    async (action) => {
      const instance = new Miniflare(
        convertV4MiniflareOptions({
          modules: true,
          script: "export default { fetch: () => new Response('ok') }",
          d1Databases: { INSTALLATION_REGISTRY: "worker-route-test" }
        })
      );
      instances.push(instance);
      const response = await worker.fetch(
        new Request(`https://relay.example/v1/notifications/${action}`, {
          method: "POST"
        }),
        {
          INSTALLATION_REGISTRY: await instance.getD1Database(
            "INSTALLATION_REGISTRY"
          ),
          RELAY_CREDENTIAL_HMAC_SECRET:
            "integration-test-secret-with-at-least-32-characters",
          RELAY_ENVIRONMENT: "development"
        }
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        outcome: {
          kind: "failure",
          error: { code: "not_found", retry: { kind: "never" } }
        }
      });
    }
  );
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

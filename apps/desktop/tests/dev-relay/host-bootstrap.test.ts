import { describe, expect, it, vi } from "vitest";

import { bootstrapDevRelayHost } from "@/dev-relay/host-bootstrap";

// Guards: option 2 starts the privileged relay host in Electron's renderer only;
// importing the same renderer from browser.html must not create a second host.
describe("development relay host bootstrap", () => {
  it("starts only in the Electron renderer for browser development", async () => {
    const startHost = vi.fn(async () => undefined);

    await bootstrapDevRelayHost({
      enabled: true,
      isBrowserClient: false,
      startHost,
    });
    await bootstrapDevRelayHost({
      enabled: true,
      isBrowserClient: true,
      startHost,
    });
    await bootstrapDevRelayHost({
      enabled: false,
      isBrowserClient: false,
      startHost,
    });

    expect(startHost).toHaveBeenCalledOnce();
  });
});

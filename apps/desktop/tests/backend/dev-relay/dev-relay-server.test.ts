import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  authorizeDevRelayUpgrade,
  startDevRelayServer,
} from "@backend/dev-relay/dev-relay-server";

const ORIGIN = "http://localhost:5173";
const TOKEN = "per-run-secret";

async function selectLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (port === null) throw new Error("Could not reserve a relay test port");
  return port;
}

function connectRelay(port: number, role: "host" | "browser"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/__streamfusion-dev?role=${role}`, {
      origin: ORIGIN,
      headers: {
        Host: "localhost:5173",
        "x-streamfusion-dev-token": TOKEN,
      },
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("message", (payload) => resolve(payload.toString()));
  });
}

function expectRejectedUpgrade(port: number, role: "host" | "browser"): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/__streamfusion-dev?role=${role}`, {
      origin: ORIGIN,
      headers: {
        Host: "localhost:5173",
        "x-streamfusion-dev-token": TOKEN,
      },
    });
    socket.once("open", () => reject(new Error(`${role} upgrade unexpectedly opened`)));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      if (response.statusCode === 403) resolve();
      else reject(new Error(`Expected 403, received ${response.statusCode}`));
    });
    socket.once("error", reject);
  });
}

// Guards: development relay rejects requests that did not pass through the exact local Vite origin
// Guards: development relay rejects requests unless Vite injected the per-run capability token
// Guards: a rebinding or hostname-confusion request cannot reuse an otherwise valid relay token
describe("development relay upgrade authorization", () => {
  const expected = {
    host: "127.0.0.1:5173",
    origin: "http://127.0.0.1:5173",
    token: "per-run-secret",
  };

  it("accepts only an exact origin and token match", () => {
    expect(
      authorizeDevRelayUpgrade(
        {
          host: expected.host,
          origin: expected.origin,
          token: expected.token,
        },
        expected
      )
    ).toBe(true);

    expect(
      authorizeDevRelayUpgrade(
        {
          host: expected.host,
          origin: "http://127.0.0.1:5173.evil.example",
          token: expected.token,
        },
        expected
      )
    ).toBe(false);

    expect(
      authorizeDevRelayUpgrade(
        {
          host: expected.host,
          origin: expected.origin,
          token: "wrong-secret",
        },
        expected
      )
    ).toBe(false);

    expect(
      authorizeDevRelayUpgrade(
        {
          host: "127.0.0.1:5173.attacker.test",
          origin: expected.origin,
          token: expected.token,
        },
        expected
      )
    ).toBe(false);
  });
});

// Guards: reloading the browser development harness replaces its prior relay peer instead of rendering "Development relay unavailable"
// Guards: browser replacement leaves the Electron host connected and routes subsequent RPC traffic only through the replacement browser
// Guards: duplicate Electron hosts remain rejected even though browser peers are replaceable
describe("development relay peer replacement", () => {
  it("replaces an authenticated browser peer while keeping the host singleton connected", async () => {
    const port = await selectLoopbackPort();
    const relay = await startDevRelayServer({
      fetchMedia: async () => new Response(null, { status: 404 }),
      port,
      token: TOKEN,
      origin: ORIGIN,
    });
    const host = await connectRelay(port, "host");
    const browser1 = await connectRelay(port, "browser");

    try {
      await expectRejectedUpgrade(port, "host");

      const browser1Closed = waitForClose(browser1);
      const browser2 = await connectRelay(port, "browser");
      try {
        await browser1Closed;

        const browserMessage = waitForMessage(browser2);
        host.send("host-to-browser2");
        await expect(browserMessage).resolves.toBe("host-to-browser2");

        const hostMessage = waitForMessage(host);
        browser2.send("browser2-to-host");
        await expect(hostMessage).resolves.toBe("browser2-to-host");

        expect(host.readyState).toBe(WebSocket.OPEN);
      } finally {
        browser2.close();
      }
    } finally {
      browser1.close();
      host.close();
      await relay.close();
    }
  });
});

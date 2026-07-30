import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import { WebSocket, WebSocketServer } from "ws";
import {
  DEV_MEDIA_PROXY_PATH,
  type DevMediaFetch,
  handleDevMediaProxyRequest,
} from "./dev-media-proxy";

const RELAY_PATH = "/__streamfusion-dev";
const TOKEN_HEADER = "x-streamfusion-dev-token";

export interface DevRelayAuthorization {
  host: string | undefined;
  origin: string | undefined;
  token: string | undefined;
}

export interface DevRelayExpectation {
  host: string;
  origin: string;
  token: string;
}

function secureStringEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function authorizeDevRelayUpgrade(
  actual: DevRelayAuthorization,
  expected: DevRelayExpectation
): boolean {
  return (
    actual.host === expected.host &&
    actual.origin === expected.origin &&
    secureStringEqual(actual.token, expected.token)
  );
}

type RelayRole = "host" | "browser";

function getRelayRole(request: IncomingMessage): RelayRole | null {
  if (!request.url) return null;
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== RELAY_PATH) return null;
  const role = url.searchParams.get("role");
  return role === "host" || role === "browser" ? role : null;
}

export interface DevRelayServer {
  close(): Promise<void>;
}

export function startDevRelayServer(options: {
  fetchMedia: DevMediaFetch;
  port: number;
  token: string;
  origin: string;
}): Promise<DevRelayServer> {
  const expected = {
    host: new URL(options.origin).host,
    origin: options.origin,
    token: options.token,
  };
  const httpServer = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", options.origin);
      if (requestUrl.pathname !== DEV_MEDIA_PROXY_PATH) {
        response.writeHead(404).end();
        return;
      }
      const tokenHeader = request.headers[TOKEN_HEADER];
      const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      let requestOrigin = request.headers.origin;
      if (!requestOrigin && request.headers.referer) {
        try {
          requestOrigin = new URL(request.headers.referer).origin;
        } catch {
          requestOrigin = undefined;
        }
      }
      if (
        !authorizeDevRelayUpgrade(
          { host: request.headers.host, origin: requestOrigin, token },
          expected
        )
      ) {
        response.writeHead(403).end();
        return;
      }

      const headers = new Headers();
      if (request.headers.range) headers.set("Range", request.headers.range);
      const proxyResponse = await handleDevMediaProxyRequest(
        new Request(requestUrl, { headers, method: request.method }),
        options.fetchMedia
      );
      for (const [name, value] of proxyResponse.headers) response.setHeader(name, value);
      response.writeHead(proxyResponse.status);
      response.end(Buffer.from(await proxyResponse.arrayBuffer()));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
  });
  const websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024,
  });
  const peers: Partial<Record<RelayRole, WebSocket>> = {};
  const queued: Record<RelayRole, Array<{ payload: Buffer; isBinary: boolean }>> = {
    host: [],
    browser: [],
  };

  httpServer.on("upgrade", (request, socket, head) => {
    const tokenHeader = request.headers[TOKEN_HEADER];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    const role = getRelayRole(request);
    if (
      !role ||
      (role === "host" && peers.host?.readyState === WebSocket.OPEN) ||
      !authorizeDevRelayUpgrade(
        { host: request.headers.host, origin: request.headers.origin, token },
        expected
      )
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      const replacedBrowser = role === "browser" ? peers.browser : undefined;
      peers[role] = websocket;
      if (
        replacedBrowser &&
        replacedBrowser !== websocket &&
        replacedBrowser.readyState === WebSocket.OPEN
      ) {
        replacedBrowser.close(1000, "Browser relay replaced");
      }
      for (const message of queued[role].splice(0)) {
        websocket.send(message.payload, { binary: message.isBinary });
      }
      websocket.on("message", (payload, isBinary) => {
        const recipientRole = role === "host" ? "browser" : "host";
        const recipient = peers[recipientRole];
        if (recipient?.readyState === WebSocket.OPEN) {
          recipient.send(payload, { binary: isBinary });
          return;
        }
        const queue = queued[recipientRole];
        if (queue.length >= 256) queue.shift();
        const bufferedPayload = Array.isArray(payload)
          ? Buffer.concat(payload)
          : Buffer.from(payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload);
        queue.push({ payload: bufferedPayload, isBinary });
      });
      websocket.once("close", () => {
        if (peers[role] === websocket) delete peers[role];
      });
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      resolve({
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            for (const peer of Object.values(peers)) peer?.close();
            websocketServer.close();
            httpServer.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

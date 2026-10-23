import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";

import type { ProtectedPlayerPreferences } from "@shared/protected-playback-types";
import { z } from "zod";

const PLAYER_ORIGIN = "https://streamfusion.test";
const LICENSE_URL = "https://widevine.twitch.keyos.com/api/v4/getLicense";
const MEDIA_HOSTS = ["ttvnw.net", "jtvnw.net", "twitchcdn.net", "cloudfront.net", "live-video.net"];
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const MAX_LICENSE_BYTES = 256 * 1024;
const MAX_TARGET_LENGTH = 8192;
const RANGE_PATTERN = /^bytes=(?:\d+-\d*|-\d+)$/;
const playbackTokenSchema = z
  .object({
    operationName: z.literal("PlaybackAccessToken"),
    variables: z
      .object({
        isLive: z.literal(true),
        login: z.string(),
        isVod: z.literal(false),
        vodID: z.literal(""),
        playerType: z.enum([
          "site",
          "embed",
          "popout",
          "autoplay",
          "picture-by-picture",
          "thunderdome",
        ]),
        platform: z.enum(["web", "android"]),
      })
      .strict(),
    extensions: z
      .object({
        persistedQuery: z
          .object({
            version: z.literal(1),
            sha256Hash: z.literal(
              "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
            ),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

interface GatewayOptions {
  channelSlug: string;
  masterUrl: string;
  customdata: string;
  refreshAuthorization?: (signal: AbortSignal) => Promise<string>;
  refreshPlayback?: (signal: AbortSignal) => Promise<{ masterUrl: string; customdata: string }>;
  updateCaptions?: (captions: ProtectedPlayerPreferences["captions"]) => void;
  preferences: Partial<ProtectedPlayerPreferences>;
  blockerEnabled: boolean;
  volume?: number;
  muted?: boolean;
  fetchUpstream?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface ProtectedTwitchGateway {
  baseUrl: string;
  close(): Promise<void>;
}

function mediaTarget(value: string): URL | null {
  if (value.length > MAX_TARGET_LENGTH) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !MEDIA_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

async function readBounded(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new Error("Request too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function send(response: ServerResponse, status: number, text = ""): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

async function pipeUpstream(
  upstream: Response,
  response: ServerResponse,
  limit: number,
  method: string
): Promise<void> {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "location",
    "etag",
    "last-modified",
  ]) {
    if (
      name === "content-length" &&
      ![null, "identity"].includes(upstream.headers.get("content-encoding"))
    )
      continue;
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  if (headers["content-length"] && Number(headers["content-length"]) > limit) {
    send(response, 502, "Upstream response too large");
    await upstream.body?.cancel();
    return;
  }
  response.writeHead(upstream.status, headers);
  if (method === "HEAD" || !upstream.body) {
    response.end();
    return;
  }
  let size = 0;
  try {
    for await (const chunk of upstream.body) {
      size += chunk.byteLength;
      if (size > limit) throw new Error("Upstream response too large");
      if (!response.write(chunk)) await once(response, "drain");
    }
    response.end();
  } catch {
    response.destroy();
  }
}

export async function createProtectedTwitchGateway(
  options: GatewayOptions
): Promise<ProtectedTwitchGateway> {
  const capability = randomBytes(32).toString("hex");
  const active = new Set<AbortController>();
  const fetchUpstream = options.fetchUpstream ?? fetch;
  let customdata = options.customdata;
  let masterUrl = options.masterUrl;
  let refreshing: Promise<string> | null = null;
  let closed = false;
  const server = createServer((request, response) => {
    void (async () => {
      const address = new URL(request.url ?? "/", "http://127.0.0.1");
      if (closed || !address.pathname.startsWith(`/s/${capability}/`)) {
        send(response, 404);
        return;
      }
      if (request.headers.origin && request.headers.origin !== PLAYER_ORIGIN) {
        send(response, 403);
        return;
      }
      response.setHeader("access-control-allow-origin", PLAYER_ORIGIN);
      response.setHeader("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type, range");
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const route = address.pathname.slice(`/s/${capability}/`.length);
      if (route === "bootstrap" && request.method === "GET") {
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(
          JSON.stringify({
            channelSlug: options.channelSlug,
            masterUrl,
            preferences: options.preferences,
            blockerEnabled: options.blockerEnabled,
            volume: options.volume ?? 100,
            muted: options.muted ?? false,
          })
        );
        return;
      }
      if (route === "media") {
        if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405);
        const target = mediaTarget(address.searchParams.get("url") ?? "");
        if (!target) return send(response, 403);
        const range = request.headers.range;
        if (range && !RANGE_PATTERN.test(range)) return send(response, 416);
        if (
          target.hostname === "usher.ttvnw.net" &&
          target.pathname.includes("/channel/hls/") &&
          target.searchParams.has("token")
        ) {
          target.searchParams.set("cdm", "wv");
        }
        const controller = new AbortController();
        active.add(controller);
        response.once("close", () => controller.abort());
        try {
          const upstream = await fetchUpstream(target.href, {
            method: request.method,
            headers: range
              ? { range, "accept-encoding": "identity" }
              : { "accept-encoding": "identity" },
            redirect: "manual",
            signal: controller.signal,
          });
          const location = upstream.headers.get("location");
          if (location && !mediaTarget(new URL(location, target).href)) return send(response, 403);
          await pipeUpstream(
            upstream,
            response,
            target.pathname.includes(".m3u8") ? MAX_PLAYLIST_BYTES : MAX_MEDIA_BYTES,
            request.method
          );
        } finally {
          active.delete(controller);
        }
        return;
      }
      if (route === "token") {
        if (request.method !== "POST") return send(response, 405);
        const parsed = playbackTokenSchema.safeParse(
          JSON.parse((await readBounded(request, 16 * 1024)).toString("utf8"))
        );
        if (
          !parsed.success ||
          parsed.data.variables.login !== options.channelSlug ||
          parsed.data.variables.platform !==
            (parsed.data.variables.playerType === "autoplay" ? "android" : "web")
        )
          return send(response, 403);
        const controller = new AbortController();
        active.add(controller);
        response.once("close", () => controller.abort());
        try {
          const upstream = await fetchUpstream("https://gql.twitch.tv/gql", {
            method: "POST",
            headers: {
              "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
              "content-type": "application/json",
            },
            body: JSON.stringify(parsed.data),
            redirect: "error",
            signal: controller.signal,
          });
          await pipeUpstream(upstream, response, 256 * 1024, "POST");
        } finally {
          active.delete(controller);
        }
        return;
      }
      if (route === "refresh") {
        if (request.method !== "GET" || !options.refreshPlayback) return send(response, 405);
        const controller = new AbortController();
        active.add(controller);
        response.once("close", () => controller.abort());
        try {
          const next = await options.refreshPlayback(controller.signal);
          if (controller.signal.aborted) return;
          masterUrl = next.masterUrl;
          customdata = next.customdata;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ masterUrl }));
        } finally {
          active.delete(controller);
        }
        return;
      }
      if (route === "captions") {
        if (request.method !== "POST" || !options.updateCaptions) return send(response, 405);
        const parsed = z
          .object({
            enabled: z.boolean(),
            source: z.enum(["platform", "local"]),
            preferredLanguage: z.string().nullable(),
            localModelId: z.string().nullable(),
            textSizePercent: z.number().min(50).max(200),
            backgroundOpacityPercent: z.number().min(0).max(100),
          })
          .strict()
          .safeParse(JSON.parse((await readBounded(request, 4096)).toString("utf8")));
        if (!parsed.success) return send(response, 400);
        options.updateCaptions(parsed.data);
        response.writeHead(204);
        response.end();
        return;
      }
      if (route === "license") {
        if (request.method !== "POST") return send(response, 405);
        const challenge = await readBounded(request, MAX_LICENSE_BYTES);
        const controller = new AbortController();
        active.add(controller);
        response.once("close", () => controller.abort());
        try {
          let upstream = await fetchUpstream(LICENSE_URL, {
            method: "POST",
            headers: { customdata, "content-type": "application/octet-stream" },
            body: new Uint8Array(challenge),
            redirect: "error",
            signal: controller.signal,
          });
          if (upstream.status === 401 && options.refreshAuthorization) {
            await upstream.body?.cancel();
            refreshing ??= options.refreshAuthorization(controller.signal).finally(() => {
              refreshing = null;
            });
            customdata = await refreshing;
            if (controller.signal.aborted) return;
            if (!customdata || customdata.length > MAX_LICENSE_BYTES)
              throw new Error("Invalid refreshed authorization");
            upstream = await fetchUpstream(LICENSE_URL, {
              method: "POST",
              headers: { customdata, "content-type": "application/octet-stream" },
              body: new Uint8Array(challenge),
              redirect: "error",
              signal: controller.signal,
            });
          }
          await pipeUpstream(upstream, response, MAX_LICENSE_BYTES, "POST");
        } finally {
          active.delete(controller);
        }
        return;
      }
      send(response, 404);
    })().catch(() => {
      if (!response.headersSent) send(response, 502, "Protected playback request failed");
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Protected playback listener unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/s/${capability}`,
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of active) controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

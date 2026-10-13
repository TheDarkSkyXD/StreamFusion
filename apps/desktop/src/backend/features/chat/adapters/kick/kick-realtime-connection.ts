import { net } from "electron";
import type { KickRealtimeConnection } from "../../../../../shared/kick-chat-types";

const CONNECTION_URL = "https://web.kick.com/api/v1/realtime/connection";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRealtimeConnection(value: unknown): KickRealtimeConnection {
  if (
    !isRecord(value) ||
    !isRecord(value.data) ||
    value.data.mode !== "websocket" ||
    !Array.isArray(value.data.connections)
  ) {
    throw new Error("Kick realtime response is invalid");
  }

  for (const connection of value.data.connections) {
    if (
      !isRecord(connection) ||
      connection.provider !== "pusher" ||
      !isRecord(connection.credentials)
    )
      continue;
    const { app_key: appKey, cluster } = connection.credentials;
    if (
      typeof appKey === "string" &&
      /^[a-zA-Z0-9]{1,128}$/.test(appKey) &&
      typeof cluster === "string" &&
      /^[a-z0-9-]{1,32}$/.test(cluster)
    ) {
      return { appKey, cluster };
    }
  }

  throw new Error("Kick realtime response is invalid");
}

export async function getKickRealtimeConnection(): Promise<KickRealtimeConnection> {
  const response = await net.fetch(CONNECTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://kick.com",
      Referer: "https://kick.com/",
    },
    body: JSON.stringify({
      client: { id: crypto.randomUUID(), type: "web" },
      capabilities: { accepted_providers: [{ provider: "pusher" }] },
    }),
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) throw new Error(`Kick realtime negotiation failed (${response.status})`);
  const payload: unknown = await response.json();
  return parseRealtimeConnection(payload);
}

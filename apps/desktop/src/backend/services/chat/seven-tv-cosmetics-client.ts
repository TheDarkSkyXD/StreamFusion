import type {
  ChatCosmeticBadge,
  SevenTvCosmeticAssignment,
  SevenTvCosmeticKind,
  SevenTvPaint,
  SevenTvPaintShadow,
  SevenTvPaintStop,
} from "@shared/chat-types";
import { sleep } from "@/lib/sleep";

export type SevenTvCosmeticEvent =
  | { type: "badge.upsert"; badge: ChatCosmeticBadge }
  | { type: "paint.upsert"; paint: SevenTvPaint }
  | { type: "assignment.upsert"; assignment: SevenTvCosmeticAssignment }
  | { type: "assignment.delete"; assignment: SevenTvCosmeticAssignment };

const SEVEN_TV_EVENT_API_URL = "wss://events.7tv.io/v3";
const SUBSCRIBE_OPCODE = 35;

export class SevenTvCosmeticsClient {
  private socket: WebSocket | null = null;
  private active = false;
  private reconnectTimer: symbol | null = null;
  private heartbeatTimer: symbol | null = null;
  private heartbeatIntervalMs: number | null = null;
  private connectionId = 0;

  constructor(
    private readonly twitchChannelId: string,
    private readonly onEvent: (event: SevenTvCosmeticEvent) => void
  ) {}

  connect(): void {
    if (this.active && this.socket) return;
    this.active = true;
    this.openSocket();
  }

  disconnect(): void {
    this.active = false;
    this.connectionId += 1;
    this.reconnectTimer = null;
    this.clearHeartbeatState();
    const socket = this.socket;
    this.socket = null;
    if (socket) closeWebSocketSafe(socket);
  }

  private openSocket(): void {
    if (!this.active) return;
    const connectionId = ++this.connectionId;
    const socket = new WebSocket(SEVEN_TV_EVENT_API_URL);
    this.socket = socket;
    socket.onopen = () => {
      if (!this.active || connectionId !== this.connectionId) return;
      for (const type of ["cosmetic.*", "entitlement.*"]) {
        socket.send(
          JSON.stringify({
            op: SUBSCRIBE_OPCODE,
            d: {
              type,
              condition: { ctx: "channel", platform: "TWITCH", id: this.twitchChannelId },
            },
          })
        );
      }
    };
    socket.onmessage = (message) => {
      if (!this.active || connectionId !== this.connectionId) return;
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (isRecord(frame) && frame.op === 4) {
        this.replaceSocket(connectionId);
        return;
      }
      if (isRecord(frame) && frame.op === 1 && isRecord(frame.d)) {
        const heartbeatInterval = frame.d.heartbeat_interval;
        if (
          typeof heartbeatInterval === "number" &&
          Number.isFinite(heartbeatInterval) &&
          heartbeatInterval > 0
        ) {
          this.heartbeatIntervalMs = heartbeatInterval;
        }
      }
      if (isRecord(frame)) this.resetHeartbeatTimer(connectionId);
      for (const event of parseSevenTvCosmeticFrame(frame)) this.onEvent(event);
    };
    socket.onclose = () => {
      if (!this.active || connectionId !== this.connectionId) return;
      this.clearHeartbeatState();
      this.socket = null;
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (!this.active || connectionId !== this.connectionId) return;
      this.socket = null;
      this.connectionId += 1;
      this.clearHeartbeatState();
      closeWebSocketSafe(socket);
      this.scheduleReconnect();
    };
  }

  private replaceSocket(connectionId: number): void {
    if (!this.active || connectionId !== this.connectionId) return;
    const socket = this.socket;
    this.socket = null;
    this.connectionId += 1;
    this.clearHeartbeatState();
    if (socket) closeWebSocketSafe(socket);
    this.openSocket();
  }

  private resetHeartbeatTimer(connectionId: number): void {
    this.clearHeartbeatTimer();
    if (this.heartbeatIntervalMs === null) return;
    const timer = Symbol("7tv-heartbeat");
    const delayMs = this.heartbeatIntervalMs * 3;
    this.heartbeatTimer = timer;
    void this.runHeartbeatDeadline(connectionId, timer, delayMs);
  }

  private clearHeartbeatTimer(): void {
    this.heartbeatTimer = null;
  }

  private clearHeartbeatState(): void {
    this.clearHeartbeatTimer();
    this.heartbeatIntervalMs = null;
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTimer) return;
    const timer = Symbol("7tv-reconnect");
    this.reconnectTimer = timer;
    void this.runReconnectDeadline(timer);
  }

  private async runHeartbeatDeadline(
    connectionId: number,
    timer: symbol,
    delayMs: number
  ): Promise<void> {
    await sleep(delayMs);
    if (this.heartbeatTimer !== timer) return;
    this.heartbeatTimer = null;
    this.replaceSocket(connectionId);
  }

  private async runReconnectDeadline(timer: symbol): Promise<void> {
    await sleep(1_000);
    if (this.reconnectTimer !== timer) return;
    this.reconnectTimer = null;
    if (!this.active) return;
    this.openSocket();
  }
}

export function parseSevenTvCosmeticFrame(frame: unknown): SevenTvCosmeticEvent[] {
  if (!isRecord(frame) || frame.op !== 0 || !isRecord(frame.d)) return [];
  if (!isRecord(frame.d.body)) return [];
  if (frame.d.type === "entitlement.create") return parseEntitlement(frame.d.body, "upsert");
  if (frame.d.type === "entitlement.delete" || frame.d.type === "entitlement.reset") {
    return parseEntitlement(frame.d.body, "delete");
  }
  if (frame.d.type !== "cosmetic.create") return [];
  const object = isRecord(frame.d.body.object) ? frame.d.body.object : null;
  const data = object && isRecord(object.data) ? object.data : null;
  if (!data || typeof data.id !== "string") return [];
  if (object?.kind === "PAINT") {
    return parseGradientPaint(data);
  }
  if (object?.kind !== "BADGE" || !isRecord(data.host)) return [];
  const hostUrl = typeof data.host.url === "string" ? data.host.url : null;
  const files = Array.isArray(data.host.files) ? data.host.files : [];
  const file = files
    .filter(isRecord)
    .filter((candidate) => typeof candidate.name === "string")
    .sort((left, right) => numericSize(left) - numericSize(right))
    .at(-1);
  if (!hostUrl || !file || typeof file.name !== "string") return [];
  const providerId = data.id;
  return [
    {
      type: "badge.upsert",
      badge: {
        id: `7tv:${providerId}`,
        provider: "7tv",
        providerId,
        title: typeof data.tooltip === "string" ? data.tooltip : "7TV badge",
        imageUrl: `${normalizeHost(hostUrl)}/${file.name}`,
      },
    },
  ];
}

function parseEntitlement(
  body: Record<string, unknown>,
  action: "upsert" | "delete"
): SevenTvCosmeticEvent[] {
  const object = isRecord(body.object) ? body.object : null;
  const user = object && isRecord(object.user) ? object.user : null;
  if (!object || !user) return [];
  const kind = parseCosmeticKind(object.kind);
  const connections = Array.isArray(user.connections) ? user.connections : [];
  const userIds = [
    ...new Set(
      connections
        .filter(isRecord)
        .filter((connection) => String(connection.platform).toUpperCase() === "TWITCH")
        .map((connection) => connection.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const style = isRecord(user.style) ? user.style : null;
  const styleId = kind === "paint" ? style?.paint_id : style?.badge_id;
  const cosmeticId =
    action === "delete" ? object.ref_id : typeof styleId === "string" ? styleId : object.ref_id;
  if (!kind || userIds.length === 0 || typeof cosmeticId !== "string") return [];
  return userIds.map((userId) => ({
    type: `assignment.${action}`,
    assignment: { userId, kind, cosmeticId },
  }));
}

function parseCosmeticKind(value: unknown): SevenTvCosmeticKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return normalized === "badge" || normalized === "paint" ? normalized : null;
}

function parseGradientPaint(data: Record<string, unknown>): SevenTvCosmeticEvent[] {
  const paintFunction = normalizePaintFunction(data.function);
  if (paintFunction === "url") {
    if (typeof data.image_url !== "string" || data.image_url.length === 0) return [];
    return [
      {
        type: "paint.upsert",
        paint: {
          id: data.id as string,
          name: typeof data.name === "string" ? data.name : "7TV paint",
          function: "url",
          imageUrl: data.image_url,
          stops: [],
          shadows: parseShadows(data.shadows),
        },
      },
    ];
  }
  if (paintFunction !== "linear-gradient" && paintFunction !== "radial-gradient") return [];
  const stops = Array.isArray(data.stops)
    ? data.stops.map(parseStop).filter((stop): stop is SevenTvPaintStop => stop !== null)
    : [];
  const shadows = parseShadows(data.shadows);
  return [
    {
      type: "paint.upsert",
      paint: {
        id: data.id as string,
        name: typeof data.name === "string" ? data.name : "7TV paint",
        function: paintFunction,
        ...(typeof data.angle === "number" ? { angle: data.angle } : {}),
        ...(typeof data.shape === "string" ? { shape: data.shape } : {}),
        ...(typeof data.repeat === "boolean" ? { repeat: data.repeat } : {}),
        stops,
        shadows,
      },
    },
  ];
}

function parseShadows(value: unknown): SevenTvPaintShadow[] {
  return Array.isArray(value)
    ? value.map(parseShadow).filter((shadow): shadow is SevenTvPaintShadow => shadow !== null)
    : [];
}

function normalizePaintFunction(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replaceAll("_", "-") : "";
}

function parseStop(value: unknown): SevenTvPaintStop | null {
  if (!isRecord(value) || typeof value.at !== "number" || typeof value.color !== "number") {
    return null;
  }
  return { at: value.at, color: packedRgbaToCss(value.color) };
}

function parseShadow(value: unknown): SevenTvPaintShadow | null {
  if (
    !isRecord(value) ||
    typeof value.x_offset !== "number" ||
    typeof value.y_offset !== "number" ||
    typeof value.radius !== "number" ||
    typeof value.color !== "number"
  ) {
    return null;
  }
  return {
    xOffset: value.x_offset,
    yOffset: value.y_offset,
    radius: value.radius,
    color: packedRgbaToCss(value.color),
  };
}

function packedRgbaToCss(value: number): string {
  const packed = value >>> 0;
  const red = (packed >>> 24) & 0xff;
  const green = (packed >>> 16) & 0xff;
  const blue = (packed >>> 8) & 0xff;
  const alpha = Number(((packed & 0xff) / 255).toFixed(3));
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function numericSize(file: Record<string, unknown>): number {
  return typeof file.width === "number" ? file.width : 0;
}

function normalizeHost(host: string): string {
  if (host.startsWith("//")) return `https:${host}`;
  if (host.startsWith("http://") || host.startsWith("https://")) return host;
  return `https://${host}`;
}

function closeWebSocketSafe(socket: WebSocket): void {
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.onopen = () => socket.close();
    socket.onerror = () => {
      socket.onopen = null;
    };
    return;
  }
  socket.onopen = null;
  socket.close();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { ChatReplayMessage } from "../../../../shared/chat-replay-types";

export interface KickChatReplayPage {
  capability: "supported";
  videoId: string;
  messages: ChatReplayMessage[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

export type KickChatReplayResult =
  | KickChatReplayPage
  | { capability: "empty"; videoId: string }
  | { capability: "unsupported"; videoId: string; reason: string }
  | { capability: "transient-failure"; videoId: string; reason: string };

export interface KickChatReplayRequest {
  videoId: string;
  offsetSeconds?: number;
  cursor?: string;
  locator?: {
    channelId?: string;
    startedAt?: string;
    videoUuid?: string;
  };
  signal?: AbortSignal;
}

export type KickReplayJsonTransport = (url: string, signal?: AbortSignal) => Promise<unknown>;

export interface KickReplayHttpResult {
  ok: boolean;
  status: number;
  body: string;
}

export interface KickReplayHttpTransports {
  directRequest(url: string, signal?: AbortSignal): Promise<KickReplayHttpResult>;
  browserRequest(url: string, signal?: AbortSignal): Promise<KickReplayHttpResult>;
}

export class KickChatReplaySourceError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "KickChatReplaySourceError";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export function createKickReplayJsonTransport({
  directRequest,
  browserRequest,
}: KickReplayHttpTransports): KickReplayJsonTransport {
  return async (url, signal) => {
    throwIfAborted(signal);
    let result: KickReplayHttpResult | undefined;
    try {
      result = await directRequest(url, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throwIfAborted(signal);
      // The persistent BrowserWindow path below is the compatibility fallback
      // for web.kick.com security-policy blocks and Chromium-only sessions.
    }
    if (!result?.ok) {
      throwIfAborted(signal);
      result = await browserRequest(url, signal);
    }
    if (!result.ok) {
      throw new KickChatReplaySourceError(
        result.status,
        `Kick Chat Replay request failed: ${result.status || "network"}`
      );
    }
    try {
      return JSON.parse(result.body) as unknown;
    } catch (error) {
      throw new KickChatReplaySourceError(0, "Kick Chat Replay returned invalid JSON", {
        cause: error,
      });
    }
  };
}

const KICK_PUBLIC_PARTITION = "persist:kick_public";
const KICK_REPLAY_REQUEST_TIMEOUT_MS = 10_000;

interface KickReplayBrowserWindow {
  isDestroyed(): boolean;
  destroy(): void;
  loadURL(url: string): Promise<unknown>;
  webContents: {
    executeJavaScript(script: string): Promise<unknown>;
  };
}

export interface KickReplayBrowserDependencies {
  acquireSlot(): Promise<() => void>;
  createWindow(): KickReplayBrowserWindow;
}

async function requestFromKickSession(
  url: string,
  signal?: AbortSignal
): Promise<KickReplayHttpResult> {
  const { session } = await import("electron");
  const timeout = AbortSignal.timeout(KICK_REPLAY_REQUEST_TIMEOUT_MS);
  const response = await session.fromPartition(KICK_PUBLIC_PARTITION).fetch(url, {
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Origin: "https://kick.com",
      Referer: "https://kick.com/",
      "X-App-Platform": "web",
      "X-Requested-With": "XMLHttpRequest",
    },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  return { ok: response.ok, status: response.status, body: await response.text() };
}

export async function executeKickReplayBrowserRequest(
  url: string,
  signal: AbortSignal | undefined,
  dependencies: KickReplayBrowserDependencies
): Promise<KickReplayHttpResult> {
  throwIfAborted(signal);
  const releaseSlot = await dependencies.acquireSlot();
  let win: KickReplayBrowserWindow | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    if (win && !win.isDestroyed()) win.destroy();
  };
  try {
    throwIfAborted(signal);
    win = dependencies.createWindow();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = new Promise<never>((_resolve, reject) => {
      // timer-allowlist: BrowserWindow loadURL deadline cleared during request cleanup
      timeoutId = setTimeout(
        () => reject(new Error("Kick Chat Replay browser request timed out")),
        KICK_REPLAY_REQUEST_TIMEOUT_MS
      );
    });
    await Promise.race([win.loadURL(url), timeout]);
    const body = (await win.webContents.executeJavaScript("document.body.innerText;")) as string;
    return { ok: true, status: 200, body };
  } catch (error) {
    if (isAbortError(error)) throw error;
    throwIfAborted(signal);
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
    if (win && !win.isDestroyed()) win.destroy();
    releaseSlot();
  }
}

async function requestFromKickBrowser(
  url: string,
  signal?: AbortSignal
): Promise<KickReplayHttpResult> {
  throwIfAborted(signal);
  const [{ createHiddenKickBrowserWindow }, { acquireBrowserWindowSlot }] = await Promise.all([
    import("./kick-hidden-browser-window"),
    import("./endpoints/channel-endpoints"),
  ]);
  throwIfAborted(signal);
  return executeKickReplayBrowserRequest(url, signal, {
    acquireSlot: acquireBrowserWindowSlot,
    createWindow: () =>
      createHiddenKickBrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: KICK_PUBLIC_PARTITION,
        },
      }),
  });
}

export const requestKickReplayJson = createKickReplayJsonTransport({
  directRequest: requestFromKickSession,
  browserRequest: requestFromKickBrowser,
});

interface KickHistoryBadgeV2 {
  name?: string;
  badge_type?: string;
  image_url?: string;
  selected?: boolean;
  metadata?: { months?: number | string } | null;
}

interface KickHistoryMessage {
  id?: string | number;
  user_id?: string | number;
  content?: string;
  created_at?: string;
  sender?: {
    id?: string | number;
    slug?: string;
    username?: string;
    identity?: {
      color?: string;
      badges_v2?: KickHistoryBadgeV2[];
    };
  };
}

interface KickHistoryResponse {
  data?: {
    messages?: KickHistoryMessage[];
    cursor?: string | null;
  };
}

const KICK_EMOTE_PATTERN = /\[emote:(\d+):([^\]]+)]/g;
const KICK_VIDEO_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseKickReplayFragments(content: string): ChatReplayMessage["fragments"] {
  const fragments: ChatReplayMessage["fragments"] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(KICK_EMOTE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      fragments.push({ type: "text", text: content.slice(lastIndex, matchIndex) });
    }
    fragments.push({
      type: "emote",
      text: match[2],
      emoteId: match[1],
      url: `https://files.kick.com/emotes/${encodeURIComponent(match[1])}/fullsize`,
    });
    lastIndex = matchIndex + match[0].length;
  }
  if (lastIndex < content.length) {
    fragments.push({ type: "text", text: content.slice(lastIndex) });
  }
  return fragments;
}

function stableBadgeId(badgeType: string, title: string): string {
  return `${badgeType}:${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

export function parseKickChatReplayPage(
  response: unknown,
  videoId: string,
  vodStartedAt: string
): KickChatReplayResult {
  const startedAtMs = Date.parse(vodStartedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new Error("Kick Chat Replay VOD start time was invalid");
  }

  const parsed = response as KickHistoryResponse;
  if (!parsed?.data || !Array.isArray(parsed.data.messages)) {
    throw new Error("Kick Chat Replay response contained an invalid history page");
  }

  const messages = parsed.data.messages.flatMap((message): ChatReplayMessage[] => {
    const sender = message.sender;
    const createdAtMs = Date.parse(message.created_at ?? "");
    const senderId = sender?.id ?? message.user_id;
    if (
      message.id === undefined ||
      senderId === undefined ||
      !sender?.slug ||
      !sender.username ||
      typeof message.content !== "string" ||
      !Number.isFinite(createdAtMs)
    ) {
      return [];
    }

    const badges = (sender.identity?.badges_v2 ?? [])
      .filter(
        (
          badge
        ): badge is KickHistoryBadgeV2 & {
          name: string;
          badge_type: string;
          image_url: string;
        } => badge.selected !== false && Boolean(badge.name && badge.badge_type && badge.image_url)
      )
      .map((badge) => ({
        id: stableBadgeId(badge.badge_type, badge.name),
        setId: badge.badge_type,
        version: String(badge.metadata?.months ?? "1"),
        imageUrl: badge.image_url,
        title: badge.name,
      }));

    return [
      {
        id: String(message.id),
        offsetSeconds: Math.max(0, (createdAtMs - startedAtMs) / 1_000),
        sender: {
          id: String(senderId),
          login: sender.slug,
          displayName: sender.username,
          ...(sender.identity?.color ? { color: sender.identity.color } : {}),
        },
        badges,
        fragments: parseKickReplayFragments(message.content),
      },
    ];
  });

  const nextCursor = parsed.data.cursor ?? null;
  if (messages.length === 0 && nextCursor === null) {
    return { capability: "empty", videoId };
  }
  return {
    capability: "supported",
    videoId,
    messages,
    nextCursor,
    hasNextPage: nextCursor !== null,
  };
}

export async function fetchKickChatReplayPage(
  request: KickChatReplayRequest,
  requestJson: KickReplayJsonTransport = requestKickReplayJson
): Promise<KickChatReplayResult> {
  let channelId = request.locator?.channelId;
  let vodStartedAt = request.locator?.startedAt;
  if (!channelId || !Number.isFinite(Date.parse(vodStartedAt ?? ""))) {
    const metadataKey =
      request.locator?.videoUuid ||
      (KICK_VIDEO_UUID_PATTERN.test(request.videoId) ? request.videoId : undefined);
    if (!metadataKey) {
      return {
        capability: "unsupported",
        videoId: request.videoId,
        reason: "vod-locator-unavailable",
      };
    }
    const metadata = (await requestJson(
      `https://kick.com/api/v1/video/${encodeURIComponent(metadataKey)}`,
      request.signal
    )) as {
      channel_id?: string | number;
      start_time?: string;
      created_at?: string;
      channel?: { id?: string | number };
      livestream?: {
        channel_id?: string | number;
        start_time?: string;
        created_at?: string;
        channel?: { id?: string | number };
      };
    };
    const resolvedChannelId =
      metadata.channel?.id ??
      metadata.livestream?.channel?.id ??
      metadata.livestream?.channel_id ??
      metadata.channel_id;
    channelId ||= resolvedChannelId === undefined ? undefined : String(resolvedChannelId);
    vodStartedAt ||=
      metadata.start_time ||
      metadata.livestream?.start_time ||
      metadata.livestream?.created_at ||
      metadata.created_at;
  }

  const vodStartedAtMs = Date.parse(vodStartedAt ?? "");
  if (!channelId || !vodStartedAt || !Number.isFinite(vodStartedAtMs)) {
    return {
      capability: "unsupported",
      videoId: request.videoId,
      reason: "vod-locator-unavailable",
    };
  }

  const query = request.cursor
    ? `cursor=${encodeURIComponent(request.cursor)}`
    : `start_time=${encodeURIComponent(
        new Date(vodStartedAtMs + Math.max(0, request.offsetSeconds ?? 0) * 1_000).toISOString()
      )}`;
  const body = await requestJson(
    `https://web.kick.com/api/v1/chat/${encodeURIComponent(channelId)}/history?${query}`,
    request.signal
  );
  return parseKickChatReplayPage(body, request.videoId, vodStartedAt);
}

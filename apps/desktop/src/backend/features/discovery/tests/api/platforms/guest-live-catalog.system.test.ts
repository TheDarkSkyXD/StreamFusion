import { describe, expect, it } from "vitest";

const KICK_PRIVATE_LIVESTREAMS = "https://api.kick.com/private/v1/livestreams";
const TWITCH_GQL = "https://gql.twitch.tv/gql";
const TWITCH_ANDROID_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const FETCH_TIMEOUT_MS = 10_000;

const kickBrowserHeaders = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://kick.com/",
  Origin: "https://kick.com",
  "X-Requested-With": "XMLHttpRequest",
} as const;

const twitchAnonymousHeaders = {
  "Client-Id": TWITCH_ANDROID_CLIENT_ID,
  "Content-Type": "application/json",
} as const;

const GET_TOP_STREAMS_QUERY = `
    query GetTopStreams($limit: Int!, $cursor: Cursor) {
      streams(first: $limit, after: $cursor) {
        edges {
          cursor
          node {
            id
            title
            viewersCount
            previewImageURL(width: 440, height: 248)
            type
            broadcaster {
              id
              login
              displayName
              profileImageURL(width: 70)
              primaryColorHex
              roles { isPartner __typename }
              __typename
            }
            freeformTags { id name __typename }
            game {
              id
              boxArtURL
              name
              displayName
              slug
              __typename
            }
            previewThumbnailProperties {
              blurReason
              __typename
            }
            __typename
          }
          __typename
        }
        pageInfo { hasNextPage __typename }
        __typename
      }
    }
  `;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOfflineNetworkError(error: unknown): boolean {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return false;
  }
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  const causeCode = isRecord(error.cause) && typeof error.cause.code === "string" ? error.cause.code : "";
  return /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ECONNRESET|fetch failed|network/i.test(
    `${error.message} ${causeCode}`
  );
}

async function fetchLiveCatalog(
  skip: (reason?: string) => void,
  label: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isOfflineNetworkError(error)) {
      skip(`${label} unreachable: ${error instanceof Error ? error.message : "network error"}`);
    }
    throw error;
  }
}

function kickLivestreams(body: unknown): unknown[] {
  if (!isRecord(body)) return [];
  const nested = isRecord(body.data) ? body.data : null;
  if (Array.isArray(nested?.livestreams)) return nested.livestreams;
  if (Array.isArray(body.livestreams)) return body.livestreams;
  return [];
}

// Guards: Kick private livestream dump returns live catalog rows without Authorization or client secrets
// Guards: Twitch anonymous GQL GetTopStreams returns live catalog rows with only the Android Client-Id
describe("guest live catalog", { timeout: 15_000, retry: 1 }, () => {
  it("returns Kick private livestream rows without Authorization", async ({ skip }) => {
    const response = await fetchLiveCatalog(
      skip,
      "Kick private livestream dump",
      KICK_PRIVATE_LIVESTREAMS,
      { headers: kickBrowserHeaders }
    );

    expect(response.status).toBe(200);
    const livestreams = kickLivestreams(await response.json());
    expect(livestreams.length).toBeGreaterThanOrEqual(1);

    const livestream = isRecord(livestreams[0]) ? livestreams[0] : null;
    expect(livestream).not.toBeNull();
    const streamer = isRecord(livestream?.streamer) ? livestream.streamer : null;
    const channel = isRecord(streamer?.channel) ? streamer.channel : null;
    const slug = typeof channel?.slug === "string" ? channel.slug : "";
    expect(slug).toEqual(expect.stringMatching(/\S/));
    expect(typeof livestream?.viewers_count).toBe("number");
  });

  it("returns Twitch anonymous GetTopStreams rows with only the Android Client-Id", async ({ skip }) => {
    const response = await fetchLiveCatalog(skip, "Twitch anonymous GQL", TWITCH_GQL, {
      method: "POST",
      headers: twitchAnonymousHeaders,
      body: JSON.stringify([
        {
          query: GET_TOP_STREAMS_QUERY,
          variables: { limit: 12, cursor: null },
        },
      ]),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(Array.isArray(body)).toBe(true);
    const first = Array.isArray(body) ? body[0] : undefined;
    const envelope = isRecord(first) ? first : null;
    expect(envelope).not.toBeNull();
    const data = isRecord(envelope?.data) ? envelope.data : null;
    const streams = isRecord(data?.streams) ? data.streams : null;
    const edges = Array.isArray(streams?.edges) ? streams.edges : [];
    expect(edges.length).toBeGreaterThanOrEqual(1);
    const firstEdge = isRecord(edges[0]) ? edges[0] : null;
    const node = isRecord(firstEdge?.node) ? firstEdge.node : null;
    expect(node?.type).toBe("live");
    const broadcaster = isRecord(node?.broadcaster) ? node.broadcaster : null;
    const login = typeof broadcaster?.login === "string" ? broadcaster.login : "";
    expect(login).toEqual(expect.stringMatching(/\S/));
  });
});

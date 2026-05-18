import { describe, expect, it, vi } from 'vitest';

import {
  searchUserAcrossChannels,
  type CrossChannelBanResult,
} from '@/backend/api/platforms/twitch/twitch-helix-bans-cross-channel';

interface MockResponse {
  status: number;
  body: unknown;
}

function makeResponse(resp: MockResponse): Response {
  return {
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    statusText: '',
    headers: new Headers(),
    json: async () => resp.body,
  } as Response;
}

// Build a fake fetch that classifies the request by URL and returns whatever
// the test's `route` map says — each route can be a static response or a
// function that takes a hit-count and returns one (used for the 429-retry case).
function buildFetch(routes: {
  users?: MockResponse | (() => MockResponse);
  banned?: (broadcasterId: string, hit: number) => MockResponse;
  onCallStart?: () => void;
  onCallEnd?: () => void;
}) {
  let userHits = 0;
  const bannedHits = new Map<string, number>();
  return async (url: RequestInfo | URL): Promise<Response> => {
    routes.onCallStart?.();
    const u = String(url);
    if (u.includes('/users?')) {
      userHits++;
      const r =
        typeof routes.users === 'function'
          ? routes.users()
          : routes.users ?? { status: 200, body: { data: [] } };
      routes.onCallEnd?.();
      return makeResponse(r);
    }
    if (u.includes('/moderation/banned')) {
      const match = /broadcaster_id=([^&]+)/.exec(u);
      const broadcasterId = match ? decodeURIComponent(match[1]) : '';
      const hit = (bannedHits.get(broadcasterId) ?? 0) + 1;
      bannedHits.set(broadcasterId, hit);
      const r = routes.banned?.(broadcasterId, hit) ?? {
        status: 200,
        body: { data: [] },
      };
      routes.onCallEnd?.();
      return makeResponse(r);
    }
    routes.onCallEnd?.();
    return makeResponse({ status: 404, body: {} });
  };
}

const CHANNELS = [
  { broadcasterId: '101', broadcasterLogin: 'alpha' },
  { broadcasterId: '102', broadcasterLogin: 'bravo' },
  { broadcasterId: '103', broadcasterLogin: 'charlie' },
];

describe('searchUserAcrossChannels', () => {
  it('resolves username to user_id and fans out across channels', async () => {
    const fetchImpl = buildFetch({
      users: { status: 200, body: { data: [{ id: '999', login: 'badguy' }] } },
      banned: (broadcasterId) => {
        if (broadcasterId === '101') {
          return {
            status: 200,
            body: {
              data: [
                {
                  user_id: '999',
                  user_login: 'badguy',
                  expires_at: '',
                  reason: 'spam',
                  moderator_login: 'mod1',
                },
              ],
            },
          };
        }
        return { status: 200, body: { data: [] } };
      },
    });

    const results = await searchUserAcrossChannels({
      username: 'badguy',
      channels: CHANNELS,
      accessToken: 'tok',
      moderatorUserId: '111',
      clientId: 'cid',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(results).toHaveLength(3);
    expect(results.find((r) => r.channelId === '101')?.status).toBe('banned');
    expect(results.find((r) => r.channelId === '102')?.status).toBe('not-banned');
  });

  it('returns an empty list when the username does not resolve', async () => {
    const fetchImpl = buildFetch({
      users: { status: 200, body: { data: [] } },
    });
    const results = await searchUserAcrossChannels({
      username: 'ghost',
      channels: CHANNELS,
      accessToken: 'tok',
      moderatorUserId: '111',
      clientId: 'cid',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(results).toEqual([]);
  });

  it('honors concurrency=2 with at most 2 simultaneous /banned fetches', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = async (url: RequestInfo | URL): Promise<Response> => {
      const u = String(url);
      if (u.includes('/users?')) {
        return makeResponse({
          status: 200,
          body: { data: [{ id: '999', login: 'x' }] },
        });
      }
      if (u.includes('/moderation/banned')) {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return makeResponse({ status: 200, body: { data: [] } });
      }
      return makeResponse({ status: 404, body: {} });
    };

    await searchUserAcrossChannels({
      username: 'x',
      channels: [
        { broadcasterId: '1', broadcasterLogin: 'a' },
        { broadcasterId: '2', broadcasterLogin: 'b' },
        { broadcasterId: '3', broadcasterLogin: 'c' },
        { broadcasterId: '4', broadcasterLogin: 'd' },
        { broadcasterId: '5', broadcasterLogin: 'e' },
      ],
      accessToken: 'tok',
      moderatorUserId: '111',
      clientId: 'cid',
      concurrency: 2,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(0);
  });

  it('429 triggers backoff and eventually returns rate-limited', async () => {
    // First two hits 429 then succeed on the third.
    const fetchImpl = buildFetch({
      users: { status: 200, body: { data: [{ id: '999', login: 'x' }] } },
      banned: (_id, hit) => {
        if (hit < 3) {
          return { status: 429, body: {} };
        }
        return { status: 200, body: { data: [] } };
      },
    });

    const results = await searchUserAcrossChannels({
      username: 'x',
      channels: [{ broadcasterId: '1', broadcasterLogin: 'a' }],
      accessToken: 'tok',
      moderatorUserId: '111',
      clientId: 'cid',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('not-banned');
  });

  it('sort order: banned > timed-out > not-banned > error > rate-limited', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const fetchImpl = buildFetch({
      users: { status: 200, body: { data: [{ id: '999', login: 'x' }] } },
      banned: (broadcasterId) => {
        if (broadcasterId === '1') {
          // rate-limited — always 429
          return { status: 429, body: {} };
        }
        if (broadcasterId === '2') {
          // not-banned
          return { status: 200, body: { data: [] } };
        }
        if (broadcasterId === '3') {
          // banned
          return {
            status: 200,
            body: {
              data: [
                {
                  user_id: '999',
                  user_login: 'x',
                  expires_at: '',
                  reason: 'r',
                  moderator_login: 'm',
                },
              ],
            },
          };
        }
        if (broadcasterId === '4') {
          // timed-out
          return {
            status: 200,
            body: {
              data: [
                {
                  user_id: '999',
                  user_login: 'x',
                  expires_at: future,
                  reason: 'r',
                  moderator_login: 'm',
                },
              ],
            },
          };
        }
        if (broadcasterId === '5') {
          // error
          return { status: 500, body: { message: 'boom' } };
        }
        return { status: 200, body: { data: [] } };
      },
    });

    const results = await searchUserAcrossChannels({
      username: 'x',
      channels: [
        { broadcasterId: '1', broadcasterLogin: 'one' },
        { broadcasterId: '2', broadcasterLogin: 'two' },
        { broadcasterId: '3', broadcasterLogin: 'three' },
        { broadcasterId: '4', broadcasterLogin: 'four' },
        { broadcasterId: '5', broadcasterLogin: 'five' },
      ],
      accessToken: 'tok',
      moderatorUserId: '111',
      clientId: 'cid',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const statuses = results.map((r) => r.status);
    expect(statuses).toEqual([
      'banned',
      'timed-out',
      'not-banned',
      'error',
      'rate-limited',
    ]);
  });

  it('calls onResult progressively as channels resolve', async () => {
    const fetchImpl = buildFetch({
      users: { status: 200, body: { data: [{ id: '999', login: 'x' }] } },
      banned: () => ({ status: 200, body: { data: [] } }),
    });
    const seen: CrossChannelBanResult[] = [];
    await searchUserAcrossChannels({
      username: 'x',
      channels: CHANNELS,
      accessToken: 'tok',
      moderatorUserId: '111',
      clientId: 'cid',
      fetchImpl: fetchImpl as typeof fetch,
      onResult: (r) => seen.push(r),
    });
    expect(seen).toHaveLength(3);
  });
});

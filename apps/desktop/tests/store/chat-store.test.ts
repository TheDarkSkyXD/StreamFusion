import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from '@/shared/auth-types';
import type { ChatConnectionStatus, ChatMessage, ChatPlatform } from '@/shared/chat-types';
import { useAuthStore } from '@/store/auth-store';
import { buildChannelKey, DEFAULT_BATCHING_INTERVAL_MS, useChatStore } from '@/store/chat-store';

// Hysteresis constants mirrored from chat-store.ts (not exported): trimming
// fires at maxMessages + TRIM_BUFFER and trims back to maxMessages - TRIM_BUFFER.
const TRIM_BUFFER = 10;
const MESSAGE_LIMIT_MAX = 1200;

/**
 * Set chatDisplay.messageLimit on the auth store so resolveMessageLimit() in
 * chat-store reads it. Pass undefined to simulate "no chatDisplay configured"
 * (the default-fallback path).
 */
function setMessageLimitPref(messageLimit: number | undefined): void {
  const chatDisplay =
    messageLimit === undefined
      ? undefined
      : ({ ...DEFAULT_CHAT_DISPLAY_PREFERENCES, messageLimit } as ChatDisplayPreferences);
  const preferences = {
    ...DEFAULT_USER_PREFERENCES,
    // When messageLimit is undefined we omit chatDisplay entirely to exercise
    // the `preferences?.chatDisplay?.messageLimit ?? default` fallback.
    ...(chatDisplay ? { chatDisplay } : { chatDisplay: undefined }),
  } as UserPreferences;
  useAuthStore.setState({ preferences });
}

function resetStore(opts: { batching?: boolean; interval?: number } = {}): void {
  // First flush any leftover batches from prior tests, then reset.
  useChatStore.getState().cleanupBatching();
  useChatStore.setState({
    messagesByChannel: {},
    pausedChannels: new Set<string>(),
    batchingEnabled: opts.batching ?? false,
    batchingInterval: opts.interval ?? DEFAULT_BATCHING_INTERVAL_MS,
    connectionStatus: {
      twitch: {
        platform: 'twitch',
        state: 'disconnected',
        channels: [],
        isAuthenticated: false,
      },
      kick: {
        platform: 'kick',
        state: 'disconnected',
        channels: [],
        isAuthenticated: false,
      },
    },
  });
}

function makeMessage(id: string, platform: ChatPlatform = 'twitch'): ChatMessage {
  return {
    id,
    platform,
    type: 'message',
    channel: 'test',
    userId: id,
    username: id,
    displayName: id,
    color: '#fff',
    badges: [],
    content: [{ type: 'text', content: 'hi' }],
    rawContent: 'hi',
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

function defaultChannelKey(platform: ChatPlatform = 'twitch'): string {
  return buildChannelKey(platform, 'test');
}

function messagesFor(channelKey = defaultChannelKey()): ChatMessage[] {
  return useChatStore.getState().messagesByChannel[channelKey] ?? [];
}

function messageIdsFor(channelKey = defaultChannelKey()): string[] {
  return messagesFor(channelKey).map((m) => m.id);
}

function storeRecord(): Record<string, unknown> {
  return useChatStore.getState() as unknown as Record<string, unknown>;
}

function makeEmoteMessage(id: string, platform: ChatPlatform = 'kick'): ChatMessage {
  const base = makeMessage(id, platform);
  return {
    ...base,
    content: [
      {
        type: 'emote',
        id: 'e1',
        name: 'PeepoClap',
        url: 'https://cdn.7tv.app/emote/e1/2x.webp',
      },
    ],
    rawContent: 'PeepoClap',
  };
}

describe('chat-store dedup prefers emote-rich duplicates (Kick optimistic-echo race)', () => {
  beforeEach(() => resetStore());

  it('addMessage replaces an existing text-only duplicate with an emote-bearing one', () => {
    const id = 'race-1';
    useChatStore.getState().addMessage(makeMessage(id, 'kick'));
    useChatStore.getState().addMessage(makeEmoteMessage(id, 'kick'));
    const msgs = messagesFor(defaultChannelKey('kick'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0]).toMatchObject({ type: 'emote', name: 'PeepoClap' });
  });

  it('addMessage keeps the emote version when the later duplicate is text-only', () => {
    const id = 'race-2';
    useChatStore.getState().addMessage(makeEmoteMessage(id, 'kick'));
    useChatStore.getState().addMessage(makeMessage(id, 'kick'));
    const msgs = messagesFor(defaultChannelKey('kick'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0]).toMatchObject({ type: 'emote', name: 'PeepoClap' });
  });

  it('flushBatch replaces a previously-stored text-only message with the emote batch entry', () => {
    resetStore({ batching: true, interval: 16 });
    const id = 'race-3';
    useChatStore.getState().addMessage(makeMessage(id, 'kick'));
    useChatStore.getState().addMessageBatched(makeEmoteMessage(id, 'kick'), defaultChannelKey('kick'));
    // makeMessage fixture sets channel: 'test', so derived key is 'kick:test'.
    useChatStore.getState().flushBatch(buildChannelKey('kick', 'test'));
    const msgs = messagesFor(defaultChannelKey('kick'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0]).toMatchObject({ type: 'emote', name: 'PeepoClap' });
  });
});

describe('chat-store updateConnectionStatus', () => {
  beforeEach(() => resetStore());

  it('returns same state ref on identical input', () => {
    const status: ChatConnectionStatus = {
      platform: 'twitch',
      state: 'connected',
      channels: ['xqc'],
      isAuthenticated: true,
    };
    useChatStore.getState().updateConnectionStatus(status);
    const before = useChatStore.getState();
    useChatStore.getState().updateConnectionStatus({ ...status }); // new object, identical fields
    const after = useChatStore.getState();
    expect(after).toBe(before);
  });

  it('updates state when status fields change', () => {
    useChatStore.getState().updateConnectionStatus({
      platform: 'twitch',
      state: 'connected',
      channels: ['xqc'],
      isAuthenticated: true,
    });
    const before = useChatStore.getState();
    useChatStore.getState().updateConnectionStatus({
      platform: 'twitch',
      state: 'disconnected',
      channels: ['xqc'],
      isAuthenticated: true,
    });
    const after = useChatStore.getState();
    expect(after).not.toBe(before);
    expect(after.connectionStatus.twitch.state).toBe('disconnected');
  });

  it('updates state when channels list changes', () => {
    useChatStore.getState().updateConnectionStatus({
      platform: 'kick',
      state: 'connected',
      channels: ['a'],
      isAuthenticated: true,
    });
    const before = useChatStore.getState();
    useChatStore.getState().updateConnectionStatus({
      platform: 'kick',
      state: 'connected',
      channels: ['a', 'b'],
      isAuthenticated: true,
    });
    const after = useChatStore.getState();
    expect(after).not.toBe(before);
    expect(after.connectionStatus.kick.channels).toEqual(['a', 'b']);
  });

  it('preserves the other platform when one updates', () => {
    useChatStore.getState().updateConnectionStatus({
      platform: 'twitch',
      state: 'connected',
      channels: ['xqc'],
      isAuthenticated: true,
    });
    const twitchSnapshot = useChatStore.getState().connectionStatus.twitch;
    useChatStore.getState().updateConnectionStatus({
      platform: 'kick',
      state: 'connected',
      channels: ['adin'],
      isAuthenticated: false,
    });
    expect(useChatStore.getState().connectionStatus.twitch).toBe(twitchSnapshot);
  });
});

describe('chat-store addMessageBatched', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore({ batching: true });
  });

  afterEach(() => {
    useChatStore.getState().cleanupBatching();
    vi.useRealTimers();
  });

  it('does not apply messages until the batch interval elapses', () => {
    const add = useChatStore.getState().addMessageBatched;
    add(makeMessage('a'), defaultChannelKey());
    add(makeMessage('b'), defaultChannelKey());
    add(makeMessage('c'), defaultChannelKey());
    // Nothing in the store yet — batched messages wait for the timer.
    expect(messagesFor()).toHaveLength(0);

    vi.advanceTimersByTime(DEFAULT_BATCHING_INTERVAL_MS);
    expect(messageIdsFor()).toEqual(['a', 'b', 'c']);
  });

  it('falls through to addMessage immediately when batching is disabled', () => {
    useChatStore.setState({ batchingEnabled: false });
    useChatStore.getState().addMessageBatched(makeMessage('a'), defaultChannelKey());
    expect(messageIdsFor()).toEqual(['a']);
  });

  it('dedups within a single batch (multi-view subscription case)', () => {
    const add = useChatStore.getState().addMessageBatched;
    const msg = makeMessage('dup', 'kick');
    // Same message enqueued three times (as if three KickChat instances all
    // received the same Pusher event).
    add(msg, defaultChannelKey('kick'));
    add(msg, defaultChannelKey('kick'));
    add(msg, defaultChannelKey('kick'));
    vi.advanceTimersByTime(DEFAULT_BATCHING_INTERVAL_MS);
    expect(messagesFor(defaultChannelKey('kick'))).toHaveLength(1);
  });

  it('addMessage flushes pending batches before appending to preserve ordering', () => {
    const add = useChatStore.getState().addMessageBatched;
    const direct = useChatStore.getState().addMessage;

    add(makeMessage('chat-1'), defaultChannelKey());
    add(makeMessage('chat-2'), defaultChannelKey());
    // System ban marker arrives before the flush window elapses.
    direct(makeMessage('ban-marker'));

    // ban-marker must land AFTER the two chat messages even though those were
    // still batched, because addMessage flushed them first.
    expect(messageIdsFor()).toEqual(['chat-1', 'chat-2', 'ban-marker']);
  });

  it('cleanupBatching flushes any pending message and prevents future flushes', () => {
    const add = useChatStore.getState().addMessageBatched;
    add(makeMessage('a'), defaultChannelKey());
    useChatStore.getState().cleanupBatching();
    // cleanupBatching must NOT lose buffered messages.
    expect(messageIdsFor()).toEqual(['a']);
    // But the batch entry is deleted, so advancing time doesn't double-add.
    vi.advanceTimersByTime(1000);
    expect(messagesFor()).toHaveLength(1);
  });
});

describe('chat-store configurable message limit (U4)', () => {
  beforeEach(() => {
    resetStore(); // batching off — addMessage takes the direct path
    setMessageLimitPref(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit);
  });

  afterEach(() => {
    // Clear the pref leak so other suites see the default-fallback behavior.
    useAuthStore.setState({ preferences: null });
  });

  function floodMessages(count: number): void {
    const add = useChatStore.getState().addMessage;
    for (let i = 0; i < count; i++) {
      add(makeMessage(`m-${i}`));
    }
  }

  it('keeps the buffer bounded at the configured limit via addMessage (AE3)', () => {
    const N = 50;
    setMessageLimitPref(N);
    // Flood well past the cap so the trim path is exercised repeatedly.
    floodMessages(N * 4);

    const msgs = messagesFor();
    // addMessage uses hysteresis: it only trims at N + TRIM_BUFFER, down to
    // N - TRIM_BUFFER, so the length oscillates within that band and never
    // exceeds N + TRIM_BUFFER. The buffer tracks the *configured* N, not the
    // old hardcoded 100.
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.length).toBeLessThanOrEqual(N + TRIM_BUFFER);
    expect(msgs.length).toBeGreaterThanOrEqual(N - TRIM_BUFFER);
    // The retained messages are the most recent ones (oldest pruned).
    const ids = msgs.map((m) => m.id);
    expect(ids).toContain(`m-${N * 4 - 1}`); // newest kept
    expect(ids).not.toContain('m-0'); // oldest pruned
  });

  it('prunes to exactly the configured limit via prependMessages (AE3)', () => {
    const N = 30;
    setMessageLimitPref(N);
    // prependMessages trims to exactly maxMessages (no hysteresis), so this is
    // the clean "stays at N" assertion.
    const batch = Array.from({ length: N + 1 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(defaultChannelKey(), batch);
    expect(messagesFor()).toHaveLength(N);
  });

  it('tracks a larger configured limit than the shipped default', () => {
    // Guards against the limit being hardwired to 100: with N=200 the buffer
    // must retain well beyond 100.
    const N = 200;
    setMessageLimitPref(N);
    floodMessages(N + 5);
    expect(messagesFor().length).toBeGreaterThan(150);
    expect(messagesFor().length).toBeLessThanOrEqual(N + TRIM_BUFFER);
  });

  it('clamps a configured value above the hard max down to MESSAGE_LIMIT_MAX (1200)', () => {
    setMessageLimitPref(10_000);
    // Use prependMessages for the exact-cap assertion. The effective cap is
    // MESSAGE_LIMIT_MAX (1200 after the per-channel migration), not 10_000.
    const batch = Array.from({ length: MESSAGE_LIMIT_MAX + 50 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(defaultChannelKey(), batch);
    expect(messagesFor()).toHaveLength(MESSAGE_LIMIT_MAX);
  });

  it('clamps a configured value below the floor up to the minimum', () => {
    // Floor is 10. A configured value of 2 must clamp up so a 1-message buffer
    // isn't enforced.
    setMessageLimitPref(2);
    const batch = Array.from({ length: 20 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(defaultChannelKey(), batch);
    // Clamped floor is 10, so exactly 10 are retained (not 2).
    expect(messagesFor()).toHaveLength(10);
  });

  it('falls back to the default 600 when chatDisplay is not configured', () => {
    setMessageLimitPref(undefined); // no chatDisplay group
    // Seed enough to exceed the new default (600) so the trim path actually
    // engages. 150 messages used to exceed the old 100 default; 800 exceeds
    // the new 600 default by the same proportion.
    const batch = Array.from({ length: 800 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(defaultChannelKey(), batch);
    // Default messageLimit is 600 after the per-channel migration.
    expect(messagesFor()).toHaveLength(600);
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit).toBe(600);
  });

  it('retains the larger paused buffer and does not lose messages on resume', () => {
    // Normal cap small so we can prove the larger paused buffer is in force.
    const N = 50;
    setMessageLimitPref(N);

    useChatStore.getState().setPaused(defaultChannelKey(), true);
    // Seed 300 messages while paused — well above the normal cap but under the
    // paused cap, so none should be trimmed.
    const batch = Array.from({ length: 300 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(defaultChannelKey(), batch);
    expect(messagesFor()).toHaveLength(300);
    expect(useChatStore.getState().messagesByChannel[defaultChannelKey()]).toHaveLength(300);

    // Resuming must NOT retroactively trim the buffer — the paused content is
    // preserved until the next trim-triggering add brings it back toward N.
    useChatStore.getState().setPaused(defaultChannelKey(), false);
    expect(messagesFor()).toHaveLength(300);
    expect(useChatStore.getState().messagesByChannel[defaultChannelKey()]).toHaveLength(300);

    // A subsequent add (now unpaused) trims toward the configured normal cap.
    useChatStore.getState().addMessage(makeMessage('live-1'));
    const len = useChatStore.getState().messagesByChannel[defaultChannelKey()].length;
    expect(len).toBeLessThanOrEqual(N + TRIM_BUFFER);
    // The newest message survives the trim.
    expect(useChatStore.getState().messagesByChannel[defaultChannelKey()].map((m) => m.id)).toContain(
      'live-1'
    );
  });
});

describe('chat-store buildChannelKey', () => {
  it('returns the composite ${platform}:${channel} string', () => {
    expect(buildChannelKey('twitch', 'xqc')).toBe('twitch:xqc');
    expect(buildChannelKey('kick', 'adin')).toBe('kick:adin');
  });

  it('disambiguates the same channel slug across platforms', () => {
    // Twitch and Kick can both have a channel slugged "xqc"; the platform
    // prefix is what keeps their buckets separate.
    expect(buildChannelKey('twitch', 'xqc')).not.toBe(buildChannelKey('kick', 'xqc'));
  });
});

describe('chat-store dropChannel', () => {
  beforeEach(() => resetStore());

  it("removes the bucket and pausedChannels entry without touching other channels", () => {
    const keyA = buildChannelKey('twitch', 'xqc');
    const keyB = buildChannelKey('kick', 'adin');
    useChatStore.getState().addMessage({ ...makeMessage('a1', 'twitch'), channel: 'xqc' });
    useChatStore.getState().addMessage({ ...makeMessage('b1', 'kick'), channel: 'adin' });
    useChatStore.getState().addMessage({ ...makeMessage('a2', 'twitch'), channel: 'xqc' });
    useChatStore.setState({ pausedChannels: new Set([keyA, keyB]) });

    useChatStore.getState().dropChannel(keyA);

    const state = useChatStore.getState();
    expect(state.messagesByChannel[keyA]).toBeUndefined();
    expect(state.messagesByChannel[keyB]?.map((m) => m.id)).toEqual(['b1']);
    expect(state.pausedChannels.has(keyA)).toBe(false);
    expect(state.pausedChannels.has(keyB)).toBe(true);
  });

  it("is a no-op for a channelKey that doesn't exist", () => {
    useChatStore.getState().addMessage({ ...makeMessage('a1', 'twitch'), channel: 'xqc' });
    const before = useChatStore.getState();
    useChatStore.getState().dropChannel(buildChannelKey('kick', 'never-seen'));
    const after = useChatStore.getState();
    expect(after.messagesByChannel).toEqual(before.messagesByChannel);
  });
});

describe('chat-store per-channel dedupe scope', () => {
  beforeEach(() => resetStore({ batching: true, interval: 50 }));
  afterEach(() => useChatStore.getState().cleanupBatching());

  it('addMessage with the same id in two channels keeps both buckets non-empty', () => {
    const id = 'shared-id';
    useChatStore.getState().addMessage({ ...makeMessage(id, 'twitch'), channel: 'xqc' });
    useChatStore.getState().addMessage({ ...makeMessage(id, 'kick'), channel: 'adin' });
    const state = useChatStore.getState();
    expect(state.messagesByChannel[buildChannelKey('twitch', 'xqc')]).toHaveLength(1);
    expect(state.messagesByChannel[buildChannelKey('kick', 'adin')]).toHaveLength(1);
  });

  it('flushBatch dedupe stays scoped to the channel — same id in two channels both survive', () => {
    vi.useFakeTimers();
    const id = 'shared-batched-id';
    useChatStore
      .getState()
      .addMessageBatched(
        { ...makeMessage(id, 'twitch'), channel: 'xqc' },
        buildChannelKey('twitch', 'xqc')
      );
    useChatStore
      .getState()
      .addMessageBatched(
        { ...makeMessage(id, 'kick'), channel: 'adin' },
        buildChannelKey('kick', 'adin')
      );
    vi.advanceTimersByTime(60);
    const state = useChatStore.getState();
    expect(state.messagesByChannel[buildChannelKey('twitch', 'xqc')]).toHaveLength(1);
    expect(state.messagesByChannel[buildChannelKey('kick', 'adin')]).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('chat-store paused cap is per-channel', () => {
  beforeEach(() => resetStore());
  afterEach(() => setMessageLimitPref(undefined));

  it('only the paused channel gets the larger MESSAGE_LIMIT_PAUSED cap', () => {
    setMessageLimitPref(50);
    const pausedKey = buildChannelKey('twitch', 'xqc');
    useChatStore.getState().setPaused(pausedKey, true);
    // Add 150 messages to A (paused) and 150 to B (not paused).
    for (let i = 0; i < 150; i++) {
      useChatStore.getState().addMessage({ ...makeMessage(`a-${i}`, 'twitch'), channel: 'xqc' });
    }
    for (let i = 0; i < 150; i++) {
      useChatStore.getState().addMessage({ ...makeMessage(`b-${i}`, 'kick'), channel: 'adin' });
    }
    const state = useChatStore.getState();
    const bucketA = state.messagesByChannel[pausedKey] ?? [];
    const bucketB = state.messagesByChannel[buildChannelKey('kick', 'adin')] ?? [];
    // A is paused → uses MESSAGE_LIMIT_PAUSED (1200) → all 150 fit, no trim.
    expect(bucketA).toHaveLength(150);
    // B is not paused → cap = 50 → trimmed to ≤ 50 + TRIM_BUFFER.
    expect(bucketB.length).toBeLessThanOrEqual(50 + TRIM_BUFFER);
  });
});

describe('chat-store per-channel cap is independent', () => {
  beforeEach(() => resetStore());
  afterEach(() => setMessageLimitPref(undefined));

  it('a busy channel trims its own bucket without affecting another channel', () => {
    // Set a low cap so the test is fast.
    setMessageLimitPref(50);
    // Add a few messages to channel B first so A's later flood cannot hide a shared-cap bug.
    for (let i = 0; i < 5; i++) {
      useChatStore.getState().addMessage({ ...makeMessage(`b-${i}`, 'kick'), channel: 'adin' });
    }
    // Flood channel A past the cap + TRIM_BUFFER hysteresis.
    for (let i = 0; i < 200; i++) {
      useChatStore.getState().addMessage({ ...makeMessage(`a-${i}`, 'twitch'), channel: 'xqc' });
    }
    const state = useChatStore.getState();
    const bucketA = state.messagesByChannel[buildChannelKey('twitch', 'xqc')] ?? [];
    const bucketB = state.messagesByChannel[buildChannelKey('kick', 'adin')] ?? [];
    // Channel A was trimmed (somewhere between cap - TRIM_BUFFER and cap + TRIM_BUFFER).
    expect(bucketA.length).toBeLessThanOrEqual(50 + TRIM_BUFFER);
    expect(bucketA.length).toBeGreaterThan(0);
    // Channel B is untouched by A's trimming.
    expect(bucketB).toHaveLength(5);
    expect(bucketB.map((m) => m.id)).toEqual(['b-0', 'b-1', 'b-2', 'b-3', 'b-4']);
  });
});

describe('chat-store prependMessages per channel', () => {
  beforeEach(() => resetStore());

  it('routes prepended messages to their own channel buckets', () => {
    const tw = [
      { ...makeMessage('h-tw-1', 'twitch'), channel: 'xqc' },
      { ...makeMessage('h-tw-2', 'twitch'), channel: 'xqc' },
    ];
    const kk = [{ ...makeMessage('h-kk-1', 'kick'), channel: 'adin' }];
    useChatStore.getState().prependMessages(buildChannelKey('twitch', 'xqc'), tw);
    useChatStore.getState().prependMessages(buildChannelKey('kick', 'adin'), kk);
    const state = useChatStore.getState();
    expect(state.messagesByChannel[buildChannelKey('twitch', 'xqc')]?.map((m) => m.id)).toEqual([
      'h-tw-1',
      'h-tw-2',
    ]);
    expect(state.messagesByChannel[buildChannelKey('kick', 'adin')]?.map((m) => m.id)).toEqual([
      'h-kk-1',
    ]);
  });

  it('does not duplicate a message already in the bucket from live arrivals', () => {
    // Live arrival first
    useChatStore.getState().addMessage({ ...makeMessage('shared', 'twitch'), channel: 'xqc' });
    // History backfill includes the same id
    useChatStore.getState().prependMessages(buildChannelKey('twitch', 'xqc'), [
      { ...makeMessage('older', 'twitch'), channel: 'xqc' },
      { ...makeMessage('shared', 'twitch'), channel: 'xqc' },
    ]);
    const bucket = useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'xqc')];
    expect(bucket?.map((m) => m.id)).toEqual(['older', 'shared']);
  });
});

describe('chat-store addMessageBatched per-channel flush timer', () => {
  beforeEach(() => {
    resetStore({ batching: true, interval: 50 });
    vi.useFakeTimers();
  });
  afterEach(() => {
    useChatStore.getState().cleanupBatching();
    vi.useRealTimers();
  });

  it('after flush, message lands in the per-channel bucket', () => {
    const msg = { ...makeMessage('b1', 'twitch'), channel: 'xqc' };
    useChatStore.getState().addMessageBatched(msg, buildChannelKey('twitch', 'xqc'));
    // Pending in batch — not yet in store
    expect(useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'xqc')]).toBeUndefined();
    // Advance past the batch interval to fire the flush timer
    vi.advanceTimersByTime(60);
    const state = useChatStore.getState();
    expect(state.messagesByChannel[buildChannelKey('twitch', 'xqc')]?.map((m) => m.id)).toEqual([
      'b1',
    ]);
  });

  it('two channels on the same platform have independent flush timers (no batch collision)', () => {
    // Two Twitch channels in a multiview that previously shared the "twitch" batch key.
    useChatStore
      .getState()
      .addMessageBatched(
        { ...makeMessage('xqc-1', 'twitch'), channel: 'xqc' },
        buildChannelKey('twitch', 'xqc')
      );
    // Advance just past the first batch's interval. The second channel's
    // batch should NOT have flushed because it has its own timer (not yet
    // started — second channel hasn't received a message yet).
    vi.advanceTimersByTime(60);
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'xqc')]?.map((m) => m.id)
    ).toEqual(['xqc-1']);
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'forsen')]
    ).toBeUndefined();

    // Now add to a different Twitch channel. Its own timer starts; flushing
    // the first channel did not flush the second.
    useChatStore
      .getState()
      .addMessageBatched(
        { ...makeMessage('forsen-1', 'twitch'), channel: 'forsen' },
        buildChannelKey('twitch', 'forsen')
      );
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'xqc')]?.map((m) => m.id)
    ).toEqual(['xqc-1']);
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'forsen')]
    ).toBeUndefined();
    vi.advanceTimersByTime(60);
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'xqc')]?.map((m) => m.id)
    ).toEqual(['xqc-1']);
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'forsen')]?.map(
        (m) => m.id
      )
    ).toEqual(['forsen-1']);
  });
});

describe('chat-store addMessage per channel', () => {
  beforeEach(() => resetStore());

  it('appends the message to the channel bucket', () => {
    const msg = { ...makeMessage('m1', 'twitch'), channel: 'xqc' };
    useChatStore.getState().addMessage(msg);
    const state = useChatStore.getState();
    expect(state.messagesByChannel[buildChannelKey('twitch', 'xqc')]).toHaveLength(1);
    expect(state.messagesByChannel[buildChannelKey('twitch', 'xqc')][0].id).toBe('m1');
  });

  it('routes messages from different channels to different buckets', () => {
    useChatStore.getState().addMessage({ ...makeMessage('t1', 'twitch'), channel: 'xqc' });
    useChatStore.getState().addMessage({ ...makeMessage('k1', 'kick'), channel: 'adin' });
    const buckets = useChatStore.getState().messagesByChannel;
    expect(buckets[buildChannelKey('twitch', 'xqc')]?.map((m) => m.id)).toEqual(['t1']);
    expect(buckets[buildChannelKey('kick', 'adin')]?.map((m) => m.id)).toEqual(['k1']);
  });

  it('keeps chronological-arrival order inside each channel bucket', () => {
    useChatStore.getState().addMessage({ ...makeMessage('a', 'twitch'), channel: 'xqc' });
    useChatStore.getState().addMessage({ ...makeMessage('b', 'kick'), channel: 'adin' });
    useChatStore.getState().addMessage({ ...makeMessage('c', 'twitch'), channel: 'xqc' });
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('twitch', 'xqc')]?.map((m) => m.id)
    ).toEqual(['a', 'c']);
    expect(
      useChatStore.getState().messagesByChannel[buildChannelKey('kick', 'adin')]?.map((m) => m.id)
    ).toEqual(['b']);
  });
});

describe('chat-store per-channel moderation actions', () => {
  beforeEach(() => resetStore());

  it('clearMessages(channelKey) removes only that channel from buckets', () => {
    const keyA = buildChannelKey('twitch', 'alpha');
    const keyB = buildChannelKey('twitch', 'bravo');
    useChatStore.getState().addMessage({ ...makeMessage('a1', 'twitch'), channel: 'alpha' });
    useChatStore.getState().addMessage({ ...makeMessage('b1', 'twitch'), channel: 'bravo' });
    useChatStore.getState().addMessage({ ...makeMessage('a2', 'twitch'), channel: 'alpha' });

    useChatStore.getState().clearMessages(keyA);

    const state = useChatStore.getState();
    expect(state.messagesByChannel[keyA]).toBeUndefined();
    expect(state.messagesByChannel[keyB]?.map((m) => m.id)).toEqual(['b1']);
  });

  it('deleteMessage(channelKey, messageId) marks only the matching channel message deleted', () => {
    const keyA = buildChannelKey('twitch', 'alpha');
    const keyB = buildChannelKey('twitch', 'bravo');
    useChatStore.getState().addMessage({ ...makeMessage('shared', 'twitch'), channel: 'alpha' });
    useChatStore.getState().addMessage({ ...makeMessage('shared', 'twitch'), channel: 'bravo' });

    useChatStore.getState().deleteMessage(keyA, 'shared');

    const state = useChatStore.getState();
    expect(state.messagesByChannel[keyA]?.[0].isDeleted).toBe(true);
    expect(state.messagesByChannel[keyB]?.[0].isDeleted).toBe(false);
  });

  it('deleteMessage(channelKey, messageId, metadata) preserves content and records deletion metadata', () => {
    const key = buildChannelKey('twitch', 'alpha');
    const deletedAt = new Date('2026-06-29T17:45:00');
    useChatStore.getState().addMessage({
      ...makeMessage('m1', 'twitch'),
      channel: 'alpha',
      rawContent: 'kept original',
      content: [{ type: 'text', content: 'kept original' }],
    });

    useChatStore
      .getState()
      .deleteMessage(key, 'm1', { deletedAt, deletedByUsername: 'ModeratorBot' });

    const deleted = useChatStore.getState().messagesByChannel[key]?.[0];
    expect(deleted).toEqual(
      expect.objectContaining({
        isDeleted: true,
        rawContent: 'kept original',
        deletedAt,
        deletedByUsername: 'ModeratorBot',
      })
    );
    expect(deleted?.content).toEqual([{ type: 'text', content: 'kept original' }]);
  });

  it('deleteMessagesByUser(channelKey, userId) marks only that user in one channel deleted', () => {
    const keyA = buildChannelKey('kick', 'alpha');
    const keyB = buildChannelKey('kick', 'bravo');
    useChatStore
      .getState()
      .addMessage({ ...makeMessage('a1', 'kick'), channel: 'alpha', userId: 'u1' });
    useChatStore
      .getState()
      .addMessage({ ...makeMessage('a2', 'kick'), channel: 'alpha', userId: 'u2' });
    useChatStore
      .getState()
      .addMessage({ ...makeMessage('b1', 'kick'), channel: 'bravo', userId: 'u1' });

    useChatStore.getState().deleteMessagesByUser(keyA, 'u1');

    const state = useChatStore.getState();
    expect(state.messagesByChannel[keyA]?.find((m) => m.id === 'a1')?.isDeleted).toBe(true);
    expect(state.messagesByChannel[keyA]?.find((m) => m.id === 'a2')?.isDeleted).toBe(false);
    expect(state.messagesByChannel[keyB]?.find((m) => m.id === 'b1')?.isDeleted).toBe(false);
  });
});

describe('chat-store per-channel fields initial state', () => {
  beforeEach(() => resetStore());

  it('initialises messagesByChannel as an empty record', () => {
    expect(useChatStore.getState().messagesByChannel).toEqual({});
  });

  it('initialises pausedChannels as an empty set', () => {
    const ps = useChatStore.getState().pausedChannels;
    expect(ps instanceof Set).toBe(true);
    expect(ps.size).toBe(0);
  });

  it('does not expose the deleted flat compatibility fields', () => {
    expect(storeRecord().messages).toBeUndefined();
    expect(storeRecord().isPaused).toBeUndefined();
  });

  it('setPaused(channelKey, paused) updates only that channel', () => {
    const keyA = buildChannelKey('twitch', 'xqc');
    const keyB = buildChannelKey('twitch', 'ninja');

    useChatStore.getState().setPaused(keyA, true);
    expect(useChatStore.getState().pausedChannels.has(keyA)).toBe(true);
    expect(useChatStore.getState().pausedChannels.has(keyB)).toBe(false);

    useChatStore.getState().setPaused(keyA, false);
    expect(useChatStore.getState().pausedChannels.has(keyA)).toBe(false);
  });

  it('setPaused does not replace pausedChannels when the channel state is unchanged', () => {
    const key = buildChannelKey('kick', 'xqc');

    const initial = useChatStore.getState().pausedChannels;
    useChatStore.getState().setPaused(key, false);
    expect(useChatStore.getState().pausedChannels).toBe(initial);

    useChatStore.getState().setPaused(key, true);
    const paused = useChatStore.getState().pausedChannels;
    useChatStore.getState().setPaused(key, true);
    expect(useChatStore.getState().pausedChannels).toBe(paused);
  });
});

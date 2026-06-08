import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from '@/shared/auth-types';
import type { ChatConnectionStatus, ChatMessage, ChatPlatform } from '@/shared/chat-types';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';

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
    messages: [],
    isPaused: false,
    batchingEnabled: opts.batching ?? false,
    batchingInterval: opts.interval ?? 50,
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
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0]).toMatchObject({ type: 'emote', name: 'PeepoClap' });
  });

  it('addMessage keeps the emote version when the later duplicate is text-only', () => {
    const id = 'race-2';
    useChatStore.getState().addMessage(makeEmoteMessage(id, 'kick'));
    useChatStore.getState().addMessage(makeMessage(id, 'kick'));
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0]).toMatchObject({ type: 'emote', name: 'PeepoClap' });
  });

  it('flushBatch replaces a previously-stored text-only message with the emote batch entry', () => {
    resetStore({ batching: true, interval: 16 });
    const id = 'race-3';
    useChatStore.getState().addMessage(makeMessage(id, 'kick'));
    useChatStore.getState().addMessageBatched(makeEmoteMessage(id, 'kick'), 'kick');
    useChatStore.getState().flushBatch('kick');
    const msgs = useChatStore.getState().messages;
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
    resetStore({ batching: true, interval: 50 });
  });

  afterEach(() => {
    useChatStore.getState().cleanupBatching();
    vi.useRealTimers();
  });

  it('does not apply messages until the batch interval elapses', () => {
    const add = useChatStore.getState().addMessageBatched;
    add(makeMessage('a'), 'twitch');
    add(makeMessage('b'), 'twitch');
    add(makeMessage('c'), 'twitch');
    // Nothing in the store yet — batched messages wait for the timer.
    expect(useChatStore.getState().messages).toHaveLength(0);

    vi.advanceTimersByTime(50);
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls through to addMessage immediately when batching is disabled', () => {
    useChatStore.setState({ batchingEnabled: false });
    useChatStore.getState().addMessageBatched(makeMessage('a'), 'twitch');
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['a']);
  });

  it('dedups within a single batch (multi-view subscription case)', () => {
    const add = useChatStore.getState().addMessageBatched;
    const msg = makeMessage('dup');
    // Same message enqueued three times (as if three KickChat instances all
    // received the same Pusher event).
    add(msg, 'kick');
    add(msg, 'kick');
    add(msg, 'kick');
    vi.advanceTimersByTime(50);
    expect(useChatStore.getState().messages).toHaveLength(1);
  });

  it('addMessage flushes pending batches before appending to preserve ordering', () => {
    const add = useChatStore.getState().addMessageBatched;
    const direct = useChatStore.getState().addMessage;

    add(makeMessage('chat-1'), 'twitch');
    add(makeMessage('chat-2'), 'twitch');
    // System ban marker arrives before the 50ms flush window elapses.
    direct(makeMessage('ban-marker'));

    // ban-marker must land AFTER the two chat messages even though those were
    // still batched, because addMessage flushed them first.
    const ids = useChatStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(['chat-1', 'chat-2', 'ban-marker']);
  });

  it('cleanupBatching flushes any pending message and prevents future flushes', () => {
    const add = useChatStore.getState().addMessageBatched;
    add(makeMessage('a'), 'twitch');
    useChatStore.getState().cleanupBatching();
    // cleanupBatching must NOT lose buffered messages.
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['a']);
    // But the batch entry is deleted, so advancing time doesn't double-add.
    vi.advanceTimersByTime(1000);
    expect(useChatStore.getState().messages).toHaveLength(1);
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

    const msgs = useChatStore.getState().messages;
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
    useChatStore.getState().prependMessages(batch);
    expect(useChatStore.getState().messages).toHaveLength(N);
  });

  it('tracks a larger configured limit than the shipped default', () => {
    // Guards against the limit being hardwired to 100: with N=200 the buffer
    // must retain well beyond 100.
    const N = 200;
    setMessageLimitPref(N);
    floodMessages(N + 5);
    expect(useChatStore.getState().messages.length).toBeGreaterThan(150);
    expect(useChatStore.getState().messages.length).toBeLessThanOrEqual(N + TRIM_BUFFER);
  });

  it('clamps a configured value above the hard max down to MESSAGE_LIMIT_MAX (1200)', () => {
    setMessageLimitPref(10_000);
    // Use prependMessages for the exact-cap assertion. The effective cap is
    // MESSAGE_LIMIT_MAX (1200 after the per-channel migration), not 10_000.
    const batch = Array.from({ length: MESSAGE_LIMIT_MAX + 50 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(batch);
    expect(useChatStore.getState().messages).toHaveLength(MESSAGE_LIMIT_MAX);
  });

  it('clamps a configured value below the floor up to the minimum', () => {
    // Floor is 10. A configured value of 2 must clamp up so a 1-message buffer
    // isn't enforced.
    setMessageLimitPref(2);
    const batch = Array.from({ length: 20 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(batch);
    // Clamped floor is 10, so exactly 10 are retained (not 2).
    expect(useChatStore.getState().messages).toHaveLength(10);
  });

  it('falls back to the default 600 when chatDisplay is not configured', () => {
    setMessageLimitPref(undefined); // no chatDisplay group
    // Seed enough to exceed the new default (600) so the trim path actually
    // engages. 150 messages used to exceed the old 100 default; 800 exceeds
    // the new 600 default by the same proportion.
    const batch = Array.from({ length: 800 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(batch);
    // Default messageLimit is 600 after the per-channel migration.
    expect(useChatStore.getState().messages).toHaveLength(600);
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit).toBe(600);
  });

  it('retains the larger paused buffer and does not lose messages on resume', () => {
    // Normal cap small so we can prove the paused buffer (400) is in force.
    const N = 50;
    setMessageLimitPref(N);

    useChatStore.getState().setPaused(true);
    // Seed 300 messages while paused — well above the normal cap but under the
    // paused cap (400 + TRIM_BUFFER), so none should be trimmed.
    const batch = Array.from({ length: 300 }, (_, i) => makeMessage(`p-${i}`));
    useChatStore.getState().prependMessages(batch);
    expect(useChatStore.getState().messages).toHaveLength(300);

    // Resuming must NOT retroactively trim the buffer — the paused content is
    // preserved until the next trim-triggering add brings it back toward N.
    useChatStore.getState().setPaused(false);
    expect(useChatStore.getState().messages).toHaveLength(300);

    // A subsequent add (now unpaused) trims toward the configured normal cap.
    useChatStore.getState().addMessage(makeMessage('live-1'));
    const len = useChatStore.getState().messages.length;
    expect(len).toBeLessThanOrEqual(N + TRIM_BUFFER);
    // The newest message survives the trim.
    expect(useChatStore.getState().messages.map((m) => m.id)).toContain('live-1');
  });
});

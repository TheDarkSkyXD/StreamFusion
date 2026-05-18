import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatConnectionStatus, ChatMessage, ChatPlatform } from '@/shared/chat-types';
import { useChatStore } from '@/store/chat-store';

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

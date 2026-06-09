import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentionAutocomplete } from '@/components/chat/MentionAutocomplete';
import type { ChatMessage } from '@/shared/chat-types';
import { buildChannelKey, useChatStore } from '@/store/chat-store';

function makeMessage(
  username: string,
  displayName: string,
  color = '#fff',
  channel = 'test'
): ChatMessage {
  return {
    id: `${username}-${Math.random()}`,
    platform: 'twitch',
    type: 'message',
    channel,
    userId: username,
    username,
    displayName,
    color,
    badges: [],
    content: [{ type: 'text', content: 'hello' }],
    rawContent: 'hello',
    timestamp: new Date(),
    isDeleted: false,
    isHighlighted: false,
    isAction: false,
  };
}

function resetChatStore(): void {
  useChatStore.setState({ messagesByChannel: {} });
}

describe('MentionAutocomplete', () => {
  beforeEach(resetChatStore);
  afterEach(resetChatStore);

  it('renders nothing when inactive', () => {
    const { container } = render(
      <MentionAutocomplete
        inputValue=""
        cursorPosition={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={false}
        platform="twitch"
        channel="test"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when input has no @', () => {
    const { container } = render(
      <MentionAutocomplete
        inputValue="hello"
        cursorPosition={5}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="twitch"
        channel="test"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('registers keydown listener once across selectedIndex changes', () => {
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey('twitch', 'test')]: [
          makeMessage('alice', 'Alice'),
          makeMessage('alex', 'Alex'),
          makeMessage('andre', 'Andre'),
        ],
      },
    });

    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const props = {
      inputValue: '@a',
      cursorPosition: 2,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      isActive: true,
      platform: 'twitch' as const,
      channel: 'test',
    };

    const { rerender } = render(<MentionAutocomplete {...props} />);

    const initialKeydowns = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(initialKeydowns).toBe(1);

    // Drive selectedIndex up and down. With the latest-ref pattern, this
    // should not re-register the listener.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });

    rerender(<MentionAutocomplete {...props} />);

    const finalKeydowns = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(finalKeydowns).toBe(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('removes listener when isActive flips to false', () => {
    useChatStore.setState({
      messagesByChannel: {
        [buildChannelKey('twitch', 'test')]: [makeMessage('alice', 'Alice')],
      },
    });

    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const initialRemoveCount = removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length;

    const props = {
      inputValue: '@a',
      cursorPosition: 2,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      isActive: true,
      platform: 'twitch' as const,
      channel: 'test',
    };

    const { rerender } = render(<MentionAutocomplete {...props} />);
    rerender(<MentionAutocomplete {...props} isActive={false} />);

    const removedKeydowns = removeSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
    expect(removedKeydowns).toBeGreaterThan(initialRemoveCount);

    removeSpy.mockRestore();
  });

  it('builds suggestions from the active channel bucket only', () => {
    const channelKey = buildChannelKey('twitch', 'alpha');
    useChatStore.setState({
      messagesByChannel: {
        [channelKey]: [makeMessage('alice', 'Alice', '#fff', 'alpha')],
        [buildChannelKey('twitch', 'bravo')]: [makeMessage('bravo', 'Bravo', '#fff', 'bravo')],
      },
    });

    const { getByText, queryByText } = render(
      <MentionAutocomplete
        inputValue="@a"
        cursorPosition={2}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        platform="twitch"
        channel="alpha"
      />
    );

    expect(getByText('Alice')).toBeInTheDocument();
    expect(queryByText('Bravo')).toBeNull();
  });
});

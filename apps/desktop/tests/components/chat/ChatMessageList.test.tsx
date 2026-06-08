import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const setPaused = vi.fn();
let mockState = {
  messages: [] as Array<{ id: string; username: string; displayName: string }>,
  isPaused: false,
};

vi.mock('@/store/chat-store', () => ({
  useChatStore: (selector?: (s: unknown) => unknown) => {
    const state = { ...mockState, setPaused };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/chat/ChatMessage', () => ({
  ChatMessage: ({ message }: { message: { displayName: string } }) => (
    <div data-testid="chat-message">{message.displayName}</div>
  ),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: Array<{ id: string }>;
    itemContent: (i: number, m: unknown) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso">
      {data.map((m, i) => (
        <div key={m.id}>{itemContent(i, m)}</div>
      ))}
    </div>
  ),
}));

import { ChatMessageList } from '@/components/chat/ChatMessageList';

// Guards: empty state (no messages yet) must still render the virtuoso container so the layout doesn't collapse and the next message has somewhere to mount
// Guards: isPaused overlay must render the "Chat paused due to scroll" banner so the viewer can recover bottom-pin scrolling without reloading
// Guards: setPaused(false) must fire on mount so a reconnect doesn't strand the list in a paused state from the prior session
describe('ChatMessageList', () => {
  it('empty: renders the virtuoso container even with no messages', () => {
    mockState.messages = [];
    mockState.isPaused = false;
    const { getByTestId } = render(<ChatMessageList />);
    expect(getByTestId('virtuoso')).toBeInTheDocument();
  });

  it('renders one row per message', () => {
    mockState.isPaused = false;
    mockState.messages = [
      // biome-ignore lint/suspicious/noExplicitAny: test shape
      { id: 'a', username: 'u1', displayName: 'User 1' } as any,
      // biome-ignore lint/suspicious/noExplicitAny: test shape
      { id: 'b', username: 'u2', displayName: 'User 2' } as any,
    ];
    const { getAllByTestId } = render(<ChatMessageList />);
    expect(getAllByTestId('chat-message')).toHaveLength(2);
  });

  it('clears paused state on mount', () => {
    mockState.messages = [];
    mockState.isPaused = false;
    render(<ChatMessageList />);
    expect(setPaused).toHaveBeenCalledWith(false);
  });

  it('isPaused: renders the paused overlay banner so the viewer can scroll back to live', () => {
    mockState.messages = [];
    mockState.isPaused = true;
    const { getByText } = render(<ChatMessageList />);
    // The default (non-hover) banner copy is "Chat paused due to scroll".
    expect(getByText(/chat paused due to scroll/i)).toBeInTheDocument();
  });
});

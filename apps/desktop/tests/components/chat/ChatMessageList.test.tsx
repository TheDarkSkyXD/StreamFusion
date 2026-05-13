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

describe('ChatMessageList', () => {
  it('renders an empty list when no messages', () => {
    mockState.messages = [];
    const { getByTestId } = render(<ChatMessageList />);
    expect(getByTestId('virtuoso')).toBeInTheDocument();
  });

  it('renders one row per message', () => {
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
    render(<ChatMessageList />);
    expect(setPaused).toHaveBeenCalledWith(false);
  });
});

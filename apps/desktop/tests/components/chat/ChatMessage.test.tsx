import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatMessage } from '@/components/chat/ChatMessage';
import type { ChatMessage as ChatMessageType } from '@/shared/chat-types';

function baseMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: 'm1',
    platform: 'twitch',
    timestamp: Date.now(),
    type: 'message',
    userId: 'u1',
    username: 'ninja',
    displayName: 'Ninja',
    color: '#ff0000',
    badges: [],
    content: [{ type: 'text', content: 'hello world' }],
    isAction: false,
    ...overrides,
  } as ChatMessageType;
}

describe('ChatMessage', () => {
  it('renders username and text fragment', () => {
    render(<ChatMessage message={baseMessage()} />);
    expect(screen.getByText('Ninja')).toBeInTheDocument();
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });

  it('renders deleted-message placeholder when isDeleted', () => {
    render(<ChatMessage message={baseMessage({ isDeleted: true })} />);
    expect(screen.getByText(/message deleted/i)).toBeInTheDocument();
  });

  it('renders ban info for ban-type messages', () => {
    render(
      <ChatMessage
        message={baseMessage({
          type: 'ban',
          banInfo: {
            bannedUsername: 'spammer',
            bannedByUsername: 'mod',
            duration: 600,
            lastMessage: 'lol',
          },
        }) as ChatMessageType}
      />
    );
    expect(screen.getByText('spammer')).toBeInTheDocument();
    expect(screen.getByText(/timed out for 10m/)).toBeInTheDocument();
  });
});

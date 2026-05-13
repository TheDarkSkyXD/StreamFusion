import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/chat/twitch/TwitchChat', () => ({
  TwitchChat: ({ channel }: { channel: string }) => <div data-testid="twitch-chat">tw:{channel}</div>,
}));

vi.mock('@/components/chat/kick/KickChat', () => ({
  KickChat: ({ channel }: { channel: string }) => <div data-testid="kick-chat">kk:{channel}</div>,
}));

import { ChatPanel } from '@/components/chat/ChatPanel';

describe('ChatPanel', () => {
  it('renders TwitchChat for twitch platform', () => {
    render(<ChatPanel initialPlatform="twitch" initialChannel="ninja" />);
    expect(screen.getByTestId('twitch-chat')).toHaveTextContent('tw:ninja');
  });

  it('renders KickChat for kick platform', () => {
    render(<ChatPanel initialPlatform="kick" initialChannel="xqc" chatroomId={123} />);
    expect(screen.getByTestId('kick-chat')).toHaveTextContent('kk:xqc');
  });

  it('defaults to twitch when no platform passed', () => {
    render(<ChatPanel initialChannel="some" />);
    expect(screen.getByTestId('twitch-chat')).toBeInTheDocument();
  });
});

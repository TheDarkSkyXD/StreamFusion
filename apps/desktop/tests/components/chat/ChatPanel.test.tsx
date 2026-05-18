import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/chat/twitch/TwitchChat', () => ({
  TwitchChat: ({ channel }: { channel: string }) => <div data-testid="twitch-chat">tw:{channel}</div>,
}));

vi.mock('@/components/chat/kick/KickChat', () => ({
  KickChat: ({ channel }: { channel: string }) => <div data-testid="kick-chat">kk:{channel}</div>,
}));

import { ChatPanel } from '@/components/chat/ChatPanel';
import {
  ChatPanelTabs,
  type ChatPanelTabId,
} from '@/components/chat/mod/ChatPanelTabs';

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

// U19 — ChatPanelTabs is the shell that wraps the chat body. The role-gated
// visibleTabs list is computed by TwitchChat/KickChat and threaded through;
// these tests cover the shell's behaviour directly (which is also what the
// AE5/AE6/AE7 acceptance examples assert).
describe('ChatPanelTabs', () => {
  const renderTabs = (visibleTabs: ChatPanelTabId[]) =>
    render(
      <ChatPanelTabs visibleTabs={visibleTabs}>
        {{
          chat: <div data-testid="chat-body">chat content</div>,
          automod: <div data-testid="automod-body">automod placeholder</div>,
          modlog: <div data-testid="modlog-body">modlog placeholder</div>,
          engagement: <div data-testid="engagement-body">engagement placeholder</div>,
        }}
      </ChatPanelTabs>,
    );

  // AE5
  it('renders no tab strip when only the chat tab is visible', () => {
    renderTabs(['chat']);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('chat-body')).toBeInTheDocument();
  });

  it('Twitch mod (not broadcaster) sees 3 tabs: Chat / AutoMod / Mod log', () => {
    renderTabs(['chat', 'automod', 'modlog']);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Chat',
      'AutoMod',
      'Mod log',
    ]);
    expect(screen.queryByText('Engagement')).toBeNull();
  });

  // AE6
  it('Twitch broadcaster sees 4 tabs including Engagement', () => {
    renderTabs(['chat', 'automod', 'modlog', 'engagement']);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Chat',
      'AutoMod',
      'Mod log',
      'Engagement',
    ]);
  });

  // AE7
  it('Kick broadcaster sees 3 tabs and no Engagement', () => {
    renderTabs(['chat', 'automod', 'modlog']);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Chat',
      'AutoMod',
      'Mod log',
    ]);
  });

  it('chat tab is active by default and its panel is visible', () => {
    renderTabs(['chat', 'automod', 'modlog']);
    const chatPanel = document.querySelector(
      '[data-tab-panel="chat"]',
    ) as HTMLElement;
    const automodPanel = document.querySelector(
      '[data-tab-panel="automod"]',
    ) as HTMLElement;
    expect(chatPanel.style.display).not.toBe('none');
    expect(automodPanel.style.display).toBe('none');
  });

  it('clicking AutoMod hides the chat content via display:none but keeps the DOM', () => {
    renderTabs(['chat', 'automod', 'modlog']);
    const automodTab = screen
      .getAllByRole('tab')
      .find((t) => t.textContent === 'AutoMod')!;
    act(() => {
      fireEvent.click(automodTab);
    });
    const chatPanel = document.querySelector(
      '[data-tab-panel="chat"]',
    ) as HTMLElement;
    const automodPanel = document.querySelector(
      '[data-tab-panel="automod"]',
    ) as HTMLElement;
    // Chat DOM is still mounted, just hidden — preserves the IRC stream.
    expect(screen.getByTestId('chat-body')).toBeInTheDocument();
    expect(chatPanel.style.display).toBe('none');
    expect(automodPanel.style.display).not.toBe('none');
  });

  it('switching tabs preserves the Chat tab DOM identity (no remount)', () => {
    // The same React element instance survives across tab switches; the
    // <div data-testid="chat-body"> is the same node before and after.
    renderTabs(['chat', 'automod', 'modlog']);
    const originalChatBody = screen.getByTestId('chat-body');
    const automodTab = screen
      .getAllByRole('tab')
      .find((t) => t.textContent === 'AutoMod')!;
    act(() => {
      fireEvent.click(automodTab);
    });
    const chatTab = screen
      .getAllByRole('tab')
      .find((t) => t.textContent === 'Chat')!;
    act(() => {
      fireEvent.click(chatTab);
    });
    expect(screen.getByTestId('chat-body')).toBe(originalChatBody);
  });

  it('renders a badge pill when the badge count is positive', () => {
    render(
      <ChatPanelTabs
        visibleTabs={['chat', 'automod']}
        badges={{ automod: 3 }}
      >
        {{
          chat: <div>c</div>,
          automod: <div>a</div>,
        }}
      </ChatPanelTabs>,
    );
    const automodTab = screen
      .getAllByRole('tab')
      .find((t) => t.textContent?.startsWith('AutoMod'))!;
    expect(automodTab.textContent).toContain('3');
  });

  it('hides the badge pill when the count is 0 or undefined', () => {
    render(
      <ChatPanelTabs
        visibleTabs={['chat', 'automod']}
        badges={{ automod: 0 }}
      >
        {{
          chat: <div>c</div>,
          automod: <div>a</div>,
        }}
      </ChatPanelTabs>,
    );
    const automodTab = screen
      .getAllByRole('tab')
      .find((t) => t.textContent?.startsWith('AutoMod'))!;
    // Just "AutoMod" with no trailing digits.
    expect(automodTab.textContent).toBe('AutoMod');
  });
});

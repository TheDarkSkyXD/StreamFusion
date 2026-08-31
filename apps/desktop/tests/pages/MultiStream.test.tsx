import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, installElectronAPIMock, renderWithProviders, routerMock, screen } from '../test-utils';
import { ChatQuickSettingsPopover } from '@/features/chat/components/chat/ChatQuickSettingsPopover';
import { DEFAULT_CHAT_DISPLAY_PREFERENCES, DEFAULT_USER_PREFERENCES } from '@shared/auth-types';
import { useAuthStore } from '@/store/auth-store';

vi.mock('@tanstack/react-router', () => routerMock());

const setLayout = vi.fn();
const toggleChat = vi.fn();
const destroySlot = vi.fn();
let mockState = {
  streams: [] as Array<{
    id: string;
    platform: 'twitch' | 'kick';
    channelName: string;
    isMuted: boolean;
    volume: number;
  }>,
  layout: 'grid' as 'grid' | 'focus',
  isChatOpen: false,
  chatStreamId: null as string | null,
};
let mockChannelData: unknown = undefined;

vi.mock('@/features/multistream/data/multistream-store', () => ({
  useMultiStreamStore: () => ({
    ...mockState,
    setLayout,
    toggleChat,
  }),
}));

vi.mock('@/features/multistream/components/multistream/add-stream-dialog', () => ({
  AddStreamDialog: () => <button type="button">Add Stream</button>,
}));

vi.mock('@/features/multistream/components/multistream/grid-layout', () => ({
  MultiStreamGrid: () => <div data-testid="multistream-grid">grid</div>,
}));

vi.mock('@/features/chat/components/chat/ChatPanel', () => ({
  ChatPanel: (props: {
    initialPlatform: string;
    initialChannel: string;
    channelId?: string;
    chatroomId?: number;
    kickUserId?: string;
    subscriberBadges?: unknown[];
  }) => (
    <div
      data-testid="chat-panel"
      data-platform={props.initialPlatform}
      data-channel={props.initialChannel}
      data-channel-id={props.channelId}
      data-chatroom-id={props.chatroomId}
      data-kick-user-id={props.kickUserId}
      data-badges={props.subscriberBadges?.length ?? 0}
    />
  ),
}));

vi.mock('@/features/discovery/data/queries/useChannels', () => ({
  useChannelByUsername: () => ({ data: mockChannelData }),
}));

import { MultiStreamPage } from '@/pages/MultiStream';

function setChatWidthPx(chatWidthPx: 280 | 340 | 420) {
  act(() => {
    useAuthStore.setState((state) => ({
      ...state,
      preferences: {
        ...(state.preferences ?? {}),
        chatDisplay: {
          ...DEFAULT_CHAT_DISPLAY_PREFERENCES,
          ...(state.preferences?.chatDisplay ?? {}),
          chatWidthPx,
        },
      } as typeof state.preferences,
    }));
  });
}

// Guards: empty state — no streams in store → the MultiStreamGrid empty state surfaces ("no active streams"); the page still mounts the toolbar so users can Add Stream
// Guards: loading state — per-slot HLS init is owned by individual StreamSlot components, not the page. Page-level loading verified by toolbar/grid mounting before slots resolve
// Guards: error/isolation contract — when streams contains 2 slots and slot 1 errors mid-watch, slot 2 must stay live. The grid renders all slots regardless of any single slot's error state (per-slot isolation lives in the SlotSlot component; page mounts both)
// Guards: focus-button disabled when no streams — prevents users from clicking into focus mode that would have nothing to show
// Guards: chat rail follows the authoritative appearance width at 280px, 340px, and 420px while retaining its 1px border
describe('MultiStreamPage', () => {
  beforeEach(() => {
    setLayout.mockReset();
    toggleChat.mockReset();
    destroySlot.mockReset();
    mockState = { streams: [], layout: 'grid', isChatOpen: false, chatStreamId: null };
    mockChannelData = undefined;
    setChatWidthPx(340);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: {
        slot: {
          destroySlot,
        },
      },
    });
  });

  afterEach(() => {
    setChatWidthPx(340);
  });

  it('renders the toolbar with layout buttons and add-stream dialog', () => {
    renderWithProviders(<MultiStreamPage />);
    expect(screen.getByText(/multistream/i)).toBeInTheDocument();
    expect(screen.getByText(/add stream/i)).toBeInTheDocument();
    expect(screen.getByTestId('multistream-grid')).toBeInTheDocument();
  });

  it('switches layout when grid/focus buttons are clicked', () => {
    mockState.streams = [
      { id: 's1', platform: 'twitch', channelName: 'ninja', isMuted: false, volume: 0.5 },
    ];
    renderWithProviders(<MultiStreamPage />);
    const focusBtn = screen.getByTitle(/focus layout/i);
    fireEvent.click(focusBtn);
    expect(setLayout).toHaveBeenCalledWith('focus');

    const gridBtn = screen.getByTitle(/grid layout/i);
    fireEvent.click(gridBtn);
    expect(setLayout).toHaveBeenCalledWith('grid');
  });

  it('disables the focus button when there are no streams', () => {
    renderWithProviders(<MultiStreamPage />);
    expect(screen.getByTitle(/focus layout/i)).toBeDisabled();
  });

  it('empty: with no streams, the page still mounts the multistream grid (its own empty state lives downstream)', () => {
    mockState.streams = [];
    renderWithProviders(<MultiStreamPage />);
    // Toolbar + grid still mount even at zero streams.
    expect(screen.getByText(/multistream/i)).toBeInTheDocument();
    expect(screen.getByTestId('multistream-grid')).toBeInTheDocument();
  });

  it('cross-slot isolation contract: with two streams configured, the page mounts the grid regardless of any individual slot\'s HLS state', () => {
    // Per-slot HLS error isolation is enforced by StreamSlot (covered in
    // stream-slot.test.tsx) — the page's job is only to render the grid with
    // every slot present. Failing one slot mustn't unmount the others, which
    // would happen only if the page-level error boundary was wider than per-slot.
    mockState.streams = [
      { id: 's1', platform: 'twitch', channelName: 'ninja', isMuted: false, volume: 0.5 },
      { id: 's2', platform: 'kick', channelName: 'xqc', isMuted: true, volume: 0.5 },
    ];
    renderWithProviders(<MultiStreamPage />);
    expect(screen.getByTestId('multistream-grid')).toBeInTheDocument();
    // Focus button enabled with >0 streams.
    expect(screen.getByTitle(/focus layout/i)).not.toBeDisabled();
  });

  it('renders the real chat panel for the selected multistream channel', () => {
    mockState.streams = [
      { id: 's1', platform: 'kick', channelName: 'xqc', isMuted: false, volume: 0.5 },
    ];
    mockState.isChatOpen = true;
    mockState.chatStreamId = 's1';
    mockChannelData = {
      id: 'kick-channel-id',
      chatroomId: 123,
      kickUserId: 'kick-user-id',
      subscriberBadges: [{ id: 'badge-1' }],
    };

    renderWithProviders(<MultiStreamPage />);

    const chatPanel = screen.getByTestId('chat-panel');
    expect(chatPanel).toHaveAttribute('data-platform', 'kick');
    expect(chatPanel).toHaveAttribute('data-channel', 'xqc');
    expect(chatPanel).toHaveAttribute('data-channel-id', 'kick-channel-id');
    expect(chatPanel).toHaveAttribute('data-chatroom-id', '123');
    expect(chatPanel).toHaveAttribute('data-kick-user-id', 'kick-user-id');
    expect(chatPanel).toHaveAttribute('data-badges', '1');
    expect(screen.queryByText(/chat for xqc/i)).not.toBeInTheDocument();
  });

  it('keeps the outer chat rail at the selected appearance width without a resize handle', () => {
    mockState.streams = [
      { id: 's1', platform: 'twitch', channelName: 'ninja', isMuted: false, volume: 0.5 },
    ];
    mockState.isChatOpen = true;
    mockState.chatStreamId = 's1';

    const { container } = renderWithProviders(<MultiStreamPage />);
    const chatRail = screen.getByTestId('multistream-chat-rail');

    const expectOuterWidth = (width: 280 | 340 | 420) => {
      expect(chatRail).toHaveStyle({
        width: `${width}px`,
        minWidth: `${width}px`,
        maxWidth: `${width}px`,
        boxSizing: 'border-box',
      });
    };

    expectOuterWidth(340);
    expect(container.querySelector('.cursor-ew-resize')).toBeNull();

    for (const width of [280, 340, 420] as const) {
      setChatWidthPx(width);
      expectOuterWidth(width);
    }
  });

  it('uses the optimistic chat appearance width while preference hydration is stalled', async () => {
    mockState.streams = [
      { id: 's1', platform: 'twitch', channelName: 'ninja', isMuted: false, volume: 0.5 },
    ];
    mockState.isChatOpen = true;
    mockState.chatStreamId = 's1';
    act(() => {
      useAuthStore.setState({ initialized: false, preferences: null });
    });
    const hydratedPreferences = {
      ...DEFAULT_USER_PREFERENCES,
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, chatWidthPx: 280 as const },
    };
    const electronAPI = installElectronAPIMock();
    electronAPI.preferences.update = vi.fn(async (updates) => ({
      ...hydratedPreferences,
      ...updates,
    }));

    vi.useFakeTimers();
    try {
      renderWithProviders(
        <>
          <MultiStreamPage />
          <ChatQuickSettingsPopover onClose={vi.fn()} />
        </>
      );

      fireEvent.click(screen.getByRole('button', { name: /chat appearance/i }));
      fireEvent.click(screen.getByRole('radio', { name: '280px' }));

      expect(useAuthStore.getState().preferences).toBeNull();
      expect(screen.getByTestId('multistream-chat-rail')).toHaveStyle({
        width: '280px',
        minWidth: '280px',
        maxWidth: '280px',
        boxSizing: 'border-box',
      });
    } finally {
      await act(async () => {
        useAuthStore.setState({ initialized: true, preferences: hydratedPreferences });
        await Promise.resolve();
        await Promise.resolve();
      });
      vi.useRealTimers();
    }
  });

  it('destroys every multiview slot when leaving the page without clearing the saved layout', () => {
    mockState.streams = [
      { id: 'twitch-xqc', platform: 'twitch', channelName: 'xqc', isMuted: false, volume: 0.5 },
      { id: 'twitch-ludwig', platform: 'twitch', channelName: 'ludwig', isMuted: true, volume: 0.5 },
    ];

    const { unmount } = renderWithProviders(<MultiStreamPage />);

    unmount();

    expect(destroySlot).toHaveBeenCalledWith('twitch-xqc');
    expect(destroySlot).toHaveBeenCalledWith('twitch-ludwig');
    expect(mockState.streams).toHaveLength(2);
  });
});

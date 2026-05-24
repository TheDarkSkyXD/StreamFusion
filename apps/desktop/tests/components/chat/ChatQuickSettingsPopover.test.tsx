import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../../test-utils';
import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
} from '@/shared/auth-types';

// Capture the latest navigate target so the "More settings" deep-link can be
// asserted. The real router isn't mounted in a unit test, so useNavigate is
// stubbed to record its argument.
const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

// Mutable chatDisplay the mocked auth store hands back. updatePreferences
// captures the patch so the spread-preserved single-field write can be
// asserted (AE4 — gear + tab edit the same global group).
const updatePreferencesMock = vi.fn(async () => undefined);
const mockChatDisplay: { value: ChatDisplayPreferences } = {
  value: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES },
};

vi.mock('@/store/auth-store', () => {
  // useChatDisplay reads `preferences?.chatDisplay` reactively AND pulls the
  // freshest value imperatively via getState() inside the writer, so both the
  // selector and getState resolve from the mutable holder.
  const buildState = () => ({
    preferences: { chatDisplay: mockChatDisplay.value },
    updatePreferences: updatePreferencesMock,
  });
  const useAuthStore = (selector?: (s: ReturnType<typeof buildState>) => unknown) => {
    const state = buildState();
    return selector ? selector(state) : state;
  };
  (useAuthStore as unknown as { getState: () => ReturnType<typeof buildState> }).getState =
    () => buildState();
  return { useAuthStore };
});

import { ChatQuickSettingsPopover } from '@/components/chat/ChatQuickSettingsPopover';

describe('ChatQuickSettingsPopover', () => {
  beforeEach(() => {
    installElectronAPIMock();
    navigateMock.mockReset();
    updatePreferencesMock.mockReset();
    mockChatDisplay.value = { ...DEFAULT_CHAT_DISPLAY_PREFERENCES };
  });

  it('renders the quick subset (font size, emote size, density, timestamps, message limit)', () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} onClearChat={vi.fn()} />);
    expect(screen.getByLabelText('Font size')).toBeInTheDocument();
    expect(screen.getByLabelText('Emote size')).toBeInTheDocument();
    expect(screen.getByText('Density')).toBeInTheDocument();
    expect(screen.getByText('Show timestamps')).toBeInTheDocument();
    expect(screen.getByLabelText('Message limit')).toBeInTheDocument();
  });

  it('does NOT render a "show badges" control (no such chatDisplay field)', () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} onClearChat={vi.fn()} />);
    expect(screen.queryByText(/badges/i)).toBeNull();
  });

  // AE4 — the gear writes the SAME global group the Chat tab reads, with the
  // spread preserved (sibling fields intact).
  it('changing font size persists chatDisplay with the spread preserved', () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} onClearChat={vi.fn()} />);
    const fontRange = screen.getByLabelText('Font size');
    act(() => {
      fireEvent.change(fontRange, { target: { value: '18' } });
    });
    expect(updatePreferencesMock).toHaveBeenCalledTimes(1);
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, fontSizePx: 18 },
    });
  });

  it('changing message limit persists chatDisplay with the spread preserved', () => {
    render(<ChatQuickSettingsPopover onClose={vi.fn()} onClearChat={vi.fn()} />);
    const limitRange = screen.getByLabelText('Message limit');
    act(() => {
      fireEvent.change(limitRange, { target: { value: '200' } });
    });
    expect(updatePreferencesMock).toHaveBeenCalledWith({
      chatDisplay: { ...DEFAULT_CHAT_DISPLAY_PREFERENCES, messageLimit: 200 },
    });
  });

  // "More settings" deep-links to the full Chat tab (/settings?tab=chat).
  it('"More settings" navigates to the Chat settings tab and closes', () => {
    const onClose = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} onClearChat={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /more settings/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings', search: { tab: 'chat' } });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Clear local chat" fires the host clear handler and closes', () => {
    const onClose = vi.fn();
    const onClearChat = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} onClearChat={onClearChat} />);
    fireEvent.click(screen.getByRole('button', { name: /clear local chat/i }));
    expect(onClearChat).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on outside-click', () => {
    const onClose = vi.fn();
    render(
      <div>
        <button type="button" data-testid="outside">
          outside
        </button>
        <ChatQuickSettingsPopover onClose={onClose} onClearChat={vi.fn()} />
      </div>,
    );
    act(() => {
      fireEvent.mouseDown(screen.getByTestId('outside'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close on inside-click', () => {
    const onClose = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} onClearChat={vi.fn()} />);
    act(() => {
      fireEvent.mouseDown(screen.getByRole('dialog'));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ChatQuickSettingsPopover onClose={onClose} onClearChat={vi.fn()} />);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

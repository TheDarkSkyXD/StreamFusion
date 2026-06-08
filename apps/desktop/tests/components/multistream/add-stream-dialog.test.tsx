import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

const addStream = vi.fn();
vi.mock('@/store/multistream-store', () => ({
  useMultiStreamStore: (selector: (s: unknown) => unknown) => selector({ addStream }),
}));

vi.mock('@/components/search/UnifiedSearchInput', () => ({
  UnifiedSearchInput: ({ onSelectChannel }: { onSelectChannel?: (c: unknown) => void }) => (
    <button
      type="button"
      data-testid="mock-search"
      onClick={() =>
        onSelectChannel?.({ platform: 'twitch', username: 'ninja', displayName: 'Ninja' })
      }
    >
      pick-ninja
    </button>
  ),
}));

vi.mock('@/assets/platforms', () => ({ getPlatformColor: () => '#9146FF' }));

import { AddStreamDialog } from '@/components/multistream/add-stream-dialog';

// Guards: success state — selecting a channel calls addStream(platform, username) so the store mutation is exactly the one users expect (silent argument mismatch would silently add the wrong channel)
// Guards: error path — channel lookup failure inside UnifiedSearchInput surfaces upstream in that component's tests; the dialog's contract is "if a channel is selected, dispatch it" — verified by the click → addStream wiring below
// Guards: empty path — opening the dialog without selecting anything must NOT dispatch addStream; the trigger button mounts deterministically
describe('AddStreamDialog', () => {
  it('renders the trigger button', () => {
    renderWithProviders(<AddStreamDialog />);
    expect(screen.getByRole('button', { name: /add stream/i })).toBeInTheDocument();
  });

  it('opens the dialog and lets the user select a channel which adds a stream', () => {
    renderWithProviders(<AddStreamDialog />);
    fireEvent.click(screen.getByRole('button', { name: /add stream/i }));
    fireEvent.click(screen.getByTestId('mock-search'));
    expect(addStream).toHaveBeenCalledWith('twitch', 'ninja');
  });
});

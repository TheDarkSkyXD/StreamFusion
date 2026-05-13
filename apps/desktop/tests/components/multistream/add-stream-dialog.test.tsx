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

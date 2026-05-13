import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotificationsDropdown } from '@/components/TopNavBar/NotificationsDropdown';

describe('NotificationsDropdown', () => {
  it('renders a bell button by default', () => {
    render(<NotificationsDropdown />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('opens a dropdown showing notifications when clicked', () => {
    render(<NotificationsDropdown />);
    fireEvent.click(screen.getByRole('button'));
    // At least one mock notification should be present.
    expect(screen.getByText(/Ninja/)).toBeInTheDocument();
  });
});

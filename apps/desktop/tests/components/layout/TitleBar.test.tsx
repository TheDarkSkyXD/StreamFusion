import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const minimize = vi.fn();
const maximize = vi.fn();
const close = vi.fn();

vi.mock('@/hooks', () => ({
  useWindowControls: () => ({ isMaximized: false, minimize, maximize, close }),
}));

import { TitleBar } from '@/components/layout/TitleBar';

describe('TitleBar', () => {
  it('renders the app brand', () => {
    render(<TitleBar />);
    expect(screen.getByText(/streamfusion/i)).toBeInTheDocument();
  });

  it('renders window control buttons on non-mac platforms', () => {
    // jsdom navigator.platform isn't "mac" by default, so controls should show.
    render(<TitleBar />);
    expect(screen.getByLabelText(/minimize/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/maximize|restore/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/close/i)).toBeInTheDocument();
  });

  it('fires close handler when close button clicked', () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(close).toHaveBeenCalled();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from '@/components/ui/switch';

describe('Switch', () => {
  it('renders an unchecked switch by default', () => {
    render(<Switch />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('data-state', 'unchecked');
  });

  it('toggles state when clicked', () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('honors checked prop', () => {
    render(<Switch checked={true} onCheckedChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
  });

  it('respects disabled', () => {
    render(<Switch disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});

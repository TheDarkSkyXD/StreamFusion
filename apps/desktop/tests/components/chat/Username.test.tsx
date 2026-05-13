import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Username } from '@/components/chat/Username';

describe('Username', () => {
  it('renders the displayName', () => {
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    expect(screen.getByText('Ninja')).toBeInTheDocument();
  });

  it('uses provided color via inline style', () => {
    render(<Username userId="1" username="ninja" displayName="Ninja" color="#ff0000" platform="twitch" />);
    expect(screen.getByText('Ninja')).toHaveStyle({ color: 'rgb(255, 0, 0)' });
  });

  it('falls back to twitch purple when no color is given', () => {
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" />);
    expect(screen.getByText('Ninja')).toHaveStyle({ color: 'rgb(145, 70, 255)' });
  });

  it('falls back to kick green when no color is given', () => {
    render(<Username userId="1" username="xqc" displayName="xQc" platform="kick" />);
    expect(screen.getByText('xQc')).toHaveStyle({ color: 'rgb(83, 252, 24)' });
  });

  it('fires onClick handler', () => {
    const onClick = vi.fn();
    render(<Username userId="1" username="ninja" displayName="Ninja" platform="twitch" onClick={onClick} />);
    fireEvent.click(screen.getByText('Ninja'));
    expect(onClick).toHaveBeenCalled();
  });
});

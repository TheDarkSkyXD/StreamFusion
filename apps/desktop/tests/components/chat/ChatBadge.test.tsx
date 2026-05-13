import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatBadge } from '@/components/chat/ChatBadge';

describe('ChatBadge', () => {
  it('renders nothing when no imageUrl is provided', () => {
    const { container } = render(<ChatBadge badge={{ title: 'mod' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the image with alt text from badge title', () => {
    render(<ChatBadge badge={{ imageUrl: 'https://x.test/b.png', title: 'Moderator' }} />);
    expect(screen.getByAltText('Moderator')).toBeInTheDocument();
  });

  it('shows tooltip image on mouseEnter', () => {
    render(<ChatBadge badge={{ imageUrl: 'https://x.test/b.png', title: 'Verified' }} platform="twitch" />);
    const img = screen.getByAltText('Verified');
    fireEvent.mouseEnter(img, { clientX: 10, clientY: 10 });
    // The tooltip portal renders another copy of the badge title and an img.
    expect(screen.getAllByAltText('Verified').length).toBeGreaterThan(1);
  });
});

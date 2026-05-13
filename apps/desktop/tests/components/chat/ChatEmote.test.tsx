import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatEmote } from '@/components/chat/ChatEmote';

describe('ChatEmote', () => {
  it('renders the emote image with the name as alt text', () => {
    render(<ChatEmote id="e1" name="Kappa" url="https://x.test/kappa.png" platform="twitch" />);
    expect(screen.getByAltText('Kappa')).toBeInTheDocument();
  });

  it('shows tooltip on mouse enter', () => {
    render(<ChatEmote id="e1" name="PogChamp" url="https://x.test/pog.png" platform="twitch" />);
    fireEvent.mouseEnter(screen.getByAltText('PogChamp'));
    // Tooltip portal renders another image with the same alt.
    expect(screen.getAllByAltText('PogChamp').length).toBeGreaterThan(1);
  });
});

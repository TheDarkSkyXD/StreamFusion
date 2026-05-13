import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MentionAutocomplete } from '@/components/chat/MentionAutocomplete';

describe('MentionAutocomplete', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(
      <MentionAutocomplete
        inputValue=""
        cursorPosition={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={false}
        recentChatters={[]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when input has no @', () => {
    const { container } = render(
      <MentionAutocomplete
        inputValue="hello"
        cursorPosition={5}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        isActive={true}
        recentChatters={[
          { username: 'ninja', displayName: 'Ninja', lastSeen: new Date() },
        ]}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

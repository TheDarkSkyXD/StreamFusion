import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/stream/related-content/index', () => ({
  RelatedContent: ({ channel }: { channel: { displayName: string } }) => (
    <div data-testid="related-mock">related-for-{channel.displayName}</div>
  ),
}));

// Note: `@/components/stream/related-content` resolves to the wrapper at
// `src/components/stream/related-content.tsx`, which re-exports from
// `./related-content/index.tsx`. Vitest handles the .tsx resolution.
// biome-ignore lint/style/useImportType: dynamic to avoid TS resolution conflict
import * as RC from '@/components/stream/related-content';

const RelatedContent = (RC as unknown as { RelatedContent: React.ComponentType<Record<string, unknown>> }).RelatedContent;

describe('RelatedContent (re-export)', () => {
  it('re-exports the related-content/index component', () => {
    renderWithProviders(
      <RelatedContent channel={{ displayName: 'X', platform: 'twitch', username: 'x' }} />
    );
    expect(screen.getByTestId('related-mock')).toHaveTextContent('related-for-X');
  });
});

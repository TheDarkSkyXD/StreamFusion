import { describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/queries/useChannels', () => ({
  useFollowedChannels: () => ({ data: undefined }),
}));

vi.mock('@/hooks/queries/useStreams', () => ({
  useFollowedStreams: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ twitchConnected: false, kickConnected: false }),
}));

vi.mock('@/store/follow-store', () => ({
  useFollowStore: (selector: (s: unknown) => unknown) => selector({ localFollows: [] }),
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

import { SidebarFollows } from '@/components/layout/SidebarFollows';

describe('SidebarFollows', () => {
  it('renders without crashing when there are no follows', () => {
    renderWithProviders(<SidebarFollows collapsed={false} />);
    // Component renders some empty state — at minimum no crash, no avatars.
    expect(screen.queryByTestId('avatar')).not.toBeInTheDocument();
  });

  it('does not throw when collapsed and empty', () => {
    expect(() => renderWithProviders(<SidebarFollows collapsed={true} />)).not.toThrow();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VideoCard } from '@/components/stream/related-content/VideoCard';
import type { VideoOrClip } from '@/components/stream/related-content/types';

// Guards: navigating to a LIVE VideoCard must scroll the main content area to top so the player isn't pushed off-screen by leftover scroll position from a prior page

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className, onClick }: { to: string; children: React.ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void }) => (
    // biome-ignore lint/a11y/useValidAnchor: stub for tests, not real navigation.
    <a href={to} className={className} onClick={onClick}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ src, alt }: { src: string; alt: string }) => (
    // biome-ignore lint/performance/noImgElement: test stub
    <img src={src} alt={alt} />
  ),
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

describe('VideoCard navigation+scroll behavior', () => {
  const baseVideo: VideoOrClip = {
    id: '123',
    title: 'Test Video',
    thumbnailUrl: 'thumb.jpg',
    duration: '0:00',
    views: '500',
    date: '2023-01-01',
    isLive: false,
  };

  it('awaits navigation then scrolls the content area to top for a LIVE (channel) card', async () => {
    const scrollTo = vi.fn();
    const scrollArea = document.createElement('div');
    scrollArea.id = 'main-content-scroll-area';
    (scrollArea as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    document.body.appendChild(scrollArea);
    mockNavigate.mockClear();

    const liveVideo: VideoOrClip = { ...baseVideo, isLive: true };
    render(<VideoCard video={liveVideo} platform="twitch" channelName="Streamer" channelData={null} />);

    await act(async () => {
      fireEvent.click(screen.getByAltText('Test Video').closest('a')!);
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/stream/$platform/$channel' }),
    );
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    document.body.removeChild(scrollArea);
  });
});

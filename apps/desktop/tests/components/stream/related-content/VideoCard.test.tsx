import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VideoCard } from '@/components/stream/related-content/VideoCard';
import { VideoOrClip } from '@/components/stream/related-content/types';

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className, onClick }: any) => (
    <a href={to} className={className} onClick={onClick}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/components/ui/card', () => ({
    Card: ({ children, className }: any) => <div className={className}>{children}</div>,
    CardContent: ({ children, className }: any) => <div className={className}>{children}</div>
}));

vi.mock('@/components/ui/proxied-image', () => ({
    ProxiedImage: ({ src, alt }: any) => <img src={src} alt={alt} />
}));

vi.mock('@/components/ui/platform-avatar', () => ({
    PlatformAvatar: ({ alt }: any) => <div>{alt}</div>
}));

describe('VideoCard', () => {
    const mockVideo: VideoOrClip = {
        id: '123',
        title: 'Test Video',
        thumbnailUrl: 'thumb.jpg',
        duration: '1h 30m',
        views: '500',
        date: '2023-01-01',
        isLive: false,
        gameName: 'Playing Game'
    };

    it('should render video details', () => {
        render(
            <VideoCard
                video={mockVideo}
                platform="twitch"
                channelName="Streamer"
                channelData={null}
            />
        );

        expect(screen.getByText('Test Video')).toBeInTheDocument();
        expect(screen.getByText('1h 30m')).toBeInTheDocument();
        expect(screen.getByText('500 views')).toBeInTheDocument();
    });

    it('should render LIVE badge when isLive is true', () => {
        const liveVideo = { ...mockVideo, isLive: true };
        render(
            <VideoCard
                video={liveVideo}
                platform="twitch"
                channelName="Streamer"
                channelData={null}
            />
        );

        expect(screen.getByText('LIVE')).toBeInTheDocument();
    });

    it('should show lock icon for Sub Only videos', () => {
        const subOnlyVideo = { ...mockVideo, isSubOnly: true };
        render(
            <VideoCard
                video={subOnlyVideo}
                platform="twitch"
                channelName="Streamer"
                channelData={null}
            />
        );

        expect(screen.getByText('SUB ONLY')).toBeInTheDocument();
    });

    it('awaits navigation then scrolls the content area to top for a LIVE (channel) card', async () => {
        const scrollTo = vi.fn();
        const scrollArea = document.createElement('div');
        scrollArea.id = 'main-content-scroll-area';
        (scrollArea as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
        document.body.appendChild(scrollArea);
        mockNavigate.mockClear();

        const liveVideo = { ...mockVideo, isLive: true, source: undefined, duration: '0:00' };
        render(
            <VideoCard video={liveVideo} platform="twitch" channelName="Streamer" channelData={null} />,
        );

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

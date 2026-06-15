import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClipDialog } from '@/components/stream/related-content/ClipDialog';
import { VideoOrClip } from '@/components/stream/related-content/types';
import { Platform } from '@/shared/auth-types';
import { UnifiedChannel } from '@/backend/api/unified/platform-types';

// Mock child components
vi.mock('@/components/ui/platform-avatar', () => ({
    PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="platform-avatar">{alt}</div>
}));

vi.mock('@/components/ui/follow-button', () => ({
    FollowButton: () => <button data-testid="follow-button">Follow</button>
}));

vi.mock('@/components/ui/loading-spinner', () => ({
    KickLoadingSpinner: () => <div data-testid="kick-loading-spinner">Kick Loading</div>,
    TwitchLoadingSpinner: () => <div data-testid="twitch-loading-spinner">Twitch Loading</div>
}));

vi.mock('@/components/player/twitch', () => ({
    TwitchVodPlayer: () => <div data-testid="twitch-vod-player">Twitch Player</div>
}));

vi.mock('@/components/player/kick', () => ({
    KickVodPlayer: () => <div data-testid="kick-vod-player">Kick Player</div>
}));

// Mock router
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mockNavigate,
    Link: ({ children, to, params }: any) => (
        <a href={to} data-params={JSON.stringify(params)} onClick={(e) => { e.preventDefault(); mockNavigate({ to, params }); }}>
            {children}
        </a>
    )
}));

describe('[Unit] ClipDialog', () => {
    const mockOnClose = vi.fn();
    const mockOnPlaybackError = vi.fn();

    const mockClip: VideoOrClip = {
        id: 'clip-123',
        title: 'Awesome Clip',
        thumbnailUrl: 'thumb.jpg',
        created_at: '2023-01-01',
        duration: '30s',
        url: 'http://clip.url',
        embedUrl: 'http://embed.url',
        gameName: 'Just Chatting',
        views: '100',
        date: '2023-01-01',
        isLive: false,
        channelSlug: 'coolstreamer',
        vodId: 'vod-123'
    };

    const mockChannelData: UnifiedChannel = {
        id: '123',
        username: 'coolstreamer',
        displayName: 'CoolStreamer',
        avatarUrl: 'avatar.jpg',
        followerCount: 1000,
        bio: 'Cool stream',
        platform: 'twitch',
        isLive: false,
        isVerified: true,
        isPartner: false
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup default window mocks if needed
        (window as any).electronAPI = {
            videos: {
                getByLivestreamId: vi.fn()
            }
        };
    });

    it('should render nothing when no clip is selected', () => {
        render(
            <ClipDialog
                selectedClip={null}
                onClose={mockOnClose}
                clipLoading={false}
                clipError={null}
                clipPlaybackUrl={null}
                platform="twitch"
                channelName="coolstreamer"
                channelData={null}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        expect(screen.queryByText('Awesome Clip')).not.toBeInTheDocument();
    });

    it('should show loading spinner when clipLoading is true', () => {
        render(
            <ClipDialog
                selectedClip={mockClip}
                onClose={mockOnClose}
                clipLoading={true}
                clipError={null}
                clipPlaybackUrl={null}
                platform="twitch"
                channelName="coolstreamer"
                channelData={mockChannelData}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        expect(screen.getByText('Loading clip...')).toBeInTheDocument();
        expect(screen.getByTestId('twitch-loading-spinner')).toBeInTheDocument();
        expect(screen.queryByTestId('kick-loading-spinner')).not.toBeInTheDocument();
        expect(screen.queryByTestId('twitch-vod-player')).not.toBeInTheDocument();
    });

    it('should show Kick loading spinner, not Twitch loading, while a Kick clip loads', () => {
        const kickClip = { ...mockClip, platform: 'kick' as Platform };

        render(
            <ClipDialog
                selectedClip={kickClip}
                onClose={mockOnClose}
                clipLoading={true}
                clipError={null}
                clipPlaybackUrl={null}
                platform="kick"
                channelName="coolstreamer"
                channelData={{ ...mockChannelData, platform: 'kick' }}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        expect(screen.getByText('Loading clip...')).toBeInTheDocument();
        expect(screen.getByTestId('kick-loading-spinner')).toBeInTheDocument();
        expect(screen.queryByTestId('twitch-loading-spinner')).not.toBeInTheDocument();
        expect(screen.queryByTestId('twitch-vod-player')).not.toBeInTheDocument();
    });

    it('should show error message when clipError is present', () => {
        render(
            <ClipDialog
                selectedClip={mockClip}
                onClose={mockOnClose}
                clipLoading={false}
                clipError="Failed to fetch clip"
                clipPlaybackUrl={null}
                platform="twitch"
                channelName="coolstreamer"
                channelData={mockChannelData}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        expect(screen.getByText('Failed to load clip')).toBeInTheDocument();
        expect(screen.getByText('Failed to fetch clip')).toBeInTheDocument();
    });

    it('should render Twitch player when platform is twitch and url is available', () => {
        render(
            <ClipDialog
                selectedClip={mockClip}
                onClose={mockOnClose}
                clipLoading={false}
                clipError={null}
                clipPlaybackUrl="http://video.url"
                platform="twitch"
                channelName="coolstreamer"
                channelData={mockChannelData}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        expect(screen.getByTestId('twitch-vod-player')).toBeInTheDocument();
        expect(screen.getAllByText('Awesome Clip').length).toBeGreaterThan(0);
        expect(screen.getAllByText('CoolStreamer').length).toBeGreaterThan(0);
    });

    it('should render Kick player when platform is kick and url is available', () => {
        const kickClip = { ...mockClip, platform: 'kick' as Platform };
        render(
            <ClipDialog
                selectedClip={kickClip}
                onClose={mockOnClose}
                clipLoading={false}
                clipError={null}
                clipPlaybackUrl="http://video.url"
                platform="kick"
                channelName="coolstreamer"
                channelData={mockChannelData}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        expect(screen.getByTestId('kick-vod-player')).toBeInTheDocument();
    });

    it('should prefer the selected clip platform over a stale parent platform', () => {
        const kickClip = { ...mockClip, platform: 'kick' as Platform };

        render(
            <ClipDialog
                selectedClip={kickClip}
                onClose={mockOnClose}
                clipLoading={false}
                clipError={null}
                clipPlaybackUrl="http://video.url"
                platform="twitch"
                channelName="coolstreamer"
                channelData={{ ...mockChannelData, platform: 'kick' }}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        expect(screen.getByTestId('kick-vod-player')).toBeInTheDocument();
        expect(screen.queryByTestId('twitch-vod-player')).not.toBeInTheDocument();
    });

    it('should handle VOD lookup for Kick when Watch Full Video is clicked', async () => {
        const kickClip = { ...mockClip, platform: 'kick' as Platform, channelSlug: 'coolstreamer', vodId: '123' };

        const mockGetByLivestreamId = vi.fn().mockResolvedValue({
            success: true,
            data: {
                id: 'vod-real-id',
                source: 'vod-source',
                title: 'Full VOD',
                channelName: 'coolstreamer'
            }
        });

        (window as any).electronAPI.videos.getByLivestreamId = mockGetByLivestreamId;

        render(
            <ClipDialog
                selectedClip={kickClip}
                onClose={mockOnClose}
                clipLoading={false}
                clipError={null}
                clipPlaybackUrl="http://video.url"
                platform="kick"
                channelName="coolstreamer"
                channelData={mockChannelData}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        const watchButton = screen.getByText('Watch Full Video');
        fireEvent.click(watchButton);

        expect(watchButton).toBeDisabled();
        expect(screen.getByText('Loading VOD...')).toBeInTheDocument();

        await waitFor(() => {
            expect(mockGetByLivestreamId).toHaveBeenCalledWith({
                channelSlug: 'coolstreamer',
                livestreamId: '123'
            });
            expect(mockOnClose).toHaveBeenCalled();
            expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({
                to: '/video/$platform/$videoId',
                params: { platform: 'kick', videoId: 'vod-real-id' }
            }));
        });
    });

    it('should show error when Kick VOD lookup fails', async () => {
        const kickClip = { ...mockClip, platform: 'kick' as Platform, channelSlug: 'coolstreamer', vodId: '123' };

        const mockGetByLivestreamId = vi.fn().mockResolvedValue({
            success: false,
            error: 'VOD not found'
        });

        (window as any).electronAPI.videos.getByLivestreamId = mockGetByLivestreamId;

        render(
            <ClipDialog
                selectedClip={kickClip}
                onClose={mockOnClose}
                clipLoading={false}
                clipError={null}
                clipPlaybackUrl="http://video.url"
                platform="kick"
                channelName="coolstreamer"
                channelData={mockChannelData}
                onPlaybackError={mockOnPlaybackError}
            />
        );

        const watchButton = screen.getByText('Watch Full Video');
        fireEvent.click(watchButton);

        await waitFor(() => {
            expect(screen.getByText('VOD not found')).toBeInTheDocument();
            expect(mockOnClose).not.toHaveBeenCalled();
        });
    });
});

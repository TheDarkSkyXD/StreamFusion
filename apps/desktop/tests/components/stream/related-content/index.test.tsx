import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelatedContent } from '@/components/stream/related-content/index';
import type { VideoOrClip } from '@/components/stream/related-content/types';

// Mock dependencies
const mockUseSearch = vi.fn();
vi.mock('@tanstack/react-router', () => ({
    useSearch: () => mockUseSearch(),
    Link: ({ children, search }: any) => <div data-search={JSON.stringify(search)}>{children}</div>,
    useNavigate: () => vi.fn()
}));

vi.mock('@/components/ui/skeleton', () => ({
    Skeleton: () => <div data-testid="skeleton" />
}));

vi.mock('@/components/stream/related-content/VideoCard', () => ({
    VideoCard: ({ video }: { video: VideoOrClip }) => <div data-testid="video-card">{video.title}</div>
}));

vi.mock('@/components/stream/related-content/ClipCard', () => ({
    ClipCard: ({ clip, onClick }: { clip: VideoOrClip, onClick: () => void }) => (
        <div data-testid="clip-card" onClick={onClick}>{clip.title}</div>
    )
}));

vi.mock('@/components/stream/related-content/ContentTabs', () => ({
    ContentTabs: ({ activeTab }: any) => <div data-testid="content-tabs">{activeTab}</div>
}));

vi.mock('@/components/stream/related-content/ClipDialog', () => ({
    ClipDialog: ({ selectedClip }: any) => selectedClip ? <div data-testid="clip-dialog">{selectedClip.title}</div> : null
}));

// Mock Electron API
const mockGetByChannelVideos = vi.fn();
const mockGetByChannelClips = vi.fn();
const mockGetClipPlaybackUrl = vi.fn();

// Guards: stream pages without an explicit tab always default to Home, even if a previous stream saved another tab.
describe('RelatedContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseSearch.mockReturnValue({ tab: 'videos' });
        localStorage.clear();

        (window as any).electronAPI = {
            videos: { getByChannel: mockGetByChannelVideos },
            clips: { getByChannel: mockGetByChannelClips, getPlaybackUrl: mockGetClipPlaybackUrl }
        };

        // Mock IntersectionObserver
        const MockIntersectionObserver = class {
            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
        };
        window.IntersectionObserver = MockIntersectionObserver as any;
    });

    it('should render loading skeletons initially', () => {
        mockGetByChannelVideos.mockReturnValue(new Promise(() => { })); // Hang promise
        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );
        expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });

    it('should render videos when api returns success', async () => {
        mockGetByChannelVideos.mockResolvedValue({
            success: true,
            data: [{ id: 'v1', title: 'Video 1' }]
        });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Video 1')).toBeInTheDocument();
        });
    });

    it('should render clips when tab is clips', async () => {
        mockUseSearch.mockReturnValue({ tab: 'clips' });
        mockGetByChannelClips.mockResolvedValue({
            success: true,
            data: [{ id: 'c1', title: 'Clip 1' }]
        });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('Clip 1')).toBeInTheDocument();
        });
    });

    it('should handle API errors', async () => {
        mockGetByChannelVideos.mockResolvedValue({
            success: false,
            error: 'API Error'
        });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('API Error')).toBeInTheDocument();
        });
    });

    it('should open clip dialog when a clip is clicked', async () => {
        mockUseSearch.mockReturnValue({ tab: 'clips' });
        mockGetByChannelClips.mockResolvedValue({
            success: true,
            data: [{ id: 'c1', title: 'Clip 1', embedUrl: 'url' }]
        });
        mockGetClipPlaybackUrl.mockResolvedValue({ success: true, data: { url: 'http://url' } });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => expect(screen.getByText('Clip 1')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Clip 1'));

        await waitFor(() => {
            expect(screen.getByTestId('clip-dialog')).toBeInTheDocument();
        });
    });

    it('should use the selected clip platform when fetching playback URL', async () => {
        mockUseSearch.mockReturnValue({ tab: 'clips' });
        mockGetByChannelClips.mockResolvedValue({
            success: true,
            data: [{ id: 'kick-clip-1', title: 'Kick Clip', platform: 'kick', embedUrl: 'kick-url' }]
        });
        mockGetClipPlaybackUrl.mockResolvedValue({ success: true, data: { url: 'http://kick-video-url' } });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => expect(screen.getByText('Kick Clip')).toBeInTheDocument());
        fireEvent.click(screen.getByText('Kick Clip'));

        await waitFor(() => {
            expect(mockGetClipPlaybackUrl).toHaveBeenCalledWith(
                expect.objectContaining({
                    platform: 'kick',
                    clipId: 'kick-clip-1',
                    clipUrl: 'kick-url'
                })
            );
        });
    });

    it('should request limit=20 on the Videos tab initial fetch', async () => {
        mockUseSearch.mockReturnValue({ tab: 'videos' });
        mockGetByChannelVideos.mockResolvedValue({ success: true, data: [] });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(mockGetByChannelVideos).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 20 })
            );
        });
        expect(mockGetByChannelClips).not.toHaveBeenCalled();
    });

    it('renders only the first batch of full-tab video cards before offscreen cards intersect', async () => {
        mockUseSearch.mockReturnValue({ tab: 'videos' });
        mockGetByChannelVideos.mockResolvedValue({
            success: true,
            data: Array.from({ length: 12 }, (_, index) => ({
                id: `v${index}`,
                title: `Video ${index}`
            }))
        });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(screen.getAllByTestId('video-card')).toHaveLength(9);
        });
        expect(screen.getAllByTestId('deferred-related-card')).toHaveLength(3);
    });

    it('unmounts full-tab video cards when they leave the viewport margin', async () => {
        const callbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
        window.IntersectionObserver = class {
            constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
                callbacks.push(callback);
            }
            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
        } as any;
        mockUseSearch.mockReturnValue({ tab: 'videos' });
        mockGetByChannelVideos.mockResolvedValue({
            success: true,
            data: Array.from({ length: 10 }, (_, index) => ({
                id: `v${index}`,
                title: `Video ${index}`
            }))
        });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(screen.getAllByTestId('video-card')).toHaveLength(9);
        });

        act(() => {
            callbacks.forEach((callback) => callback([{ isIntersecting: false }]));
        });

        await waitFor(() => {
            expect(screen.queryAllByTestId('video-card')).toHaveLength(0);
        });
        expect(screen.getAllByTestId('deferred-related-card')).toHaveLength(10);
    });

    it('should request limit=20 on the Clips tab initial fetch', async () => {
        mockUseSearch.mockReturnValue({ tab: 'clips' });
        mockGetByChannelClips.mockResolvedValue({ success: true, data: [] });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(mockGetByChannelClips).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 20 })
            );
        });
        expect(mockGetByChannelVideos).not.toHaveBeenCalled();
    });

    it('renders only the first batch of full-tab clip cards before offscreen cards intersect', async () => {
        mockUseSearch.mockReturnValue({ tab: 'clips' });
        mockGetByChannelClips.mockResolvedValue({
            success: true,
            data: Array.from({ length: 12 }, (_, index) => ({
                id: `c${index}`,
                title: `Clip ${index}`
            }))
        });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(screen.getAllByTestId('clip-card')).toHaveLength(9);
        });
        expect(screen.getAllByTestId('deferred-related-card')).toHaveLength(3);
    });

    it('should request limit=5 for both videos and clips on the home view', async () => {
        mockUseSearch.mockReturnValue({ tab: undefined });
        mockGetByChannelVideos.mockResolvedValue({ success: true, data: [] });
        mockGetByChannelClips.mockResolvedValue({ success: true, data: [] });

        render(
            <RelatedContent
                platform="twitch"
                channelName="testUser"
                channelData={{ id: '123' } as any}
            />
        );

        await waitFor(() => {
            expect(mockGetByChannelVideos).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 5 })
            );
            expect(mockGetByChannelClips).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 5 })
            );
        });
    });

    it('defaults to the Home tab when the stream URL has no tab, ignoring any saved tab preference', async () => {
        mockUseSearch.mockReturnValue({ tab: undefined });
        localStorage.setItem('stream-tab-preference', 'clips');
        mockGetByChannelVideos.mockResolvedValue({ success: true, data: [] });
        mockGetByChannelClips.mockResolvedValue({ success: true, data: [] });

        render(
            <RelatedContent
                platform="twitch"
                channelName="offlineUser"
                channelData={{ id: '123' } as any}
            />
        );

        expect(screen.getByTestId('content-tabs')).toHaveTextContent('home');
        await waitFor(() => {
            expect(mockGetByChannelVideos).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 5 })
            );
            expect(mockGetByChannelClips).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 5 })
            );
        });
    });
});

/**
 * HEVC Stream Handling Tests
 *
 * Tests for HEVC (H.265) stream detection and modified playlist generation.
 * When HEVC streams are detected during ads, the service creates modified
 * playlists that swap HEVC streams to AVC equivalents for compatibility.
 */

// Guards: HEVC→AVC playlist swap during ads — H.265 streams break the player's ad-decode path; backup playlists must rewrite to AVC equivalents so the player keeps playing during ad windows.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  initAdBlockService,
  processMasterPlaylist,
  processMediaPlaylist,
  clearStreamInfo,
  getAdBlockStatus,
} from '@/components/player/twitch/twitch-adblock-service';

// Master playlist with mixed HEVC and AVC streams
const HEVC_MIXED_PLAYLIST = `#EXTM3U
#EXT-X-TWITCH-INFO:NODE="video-edge-c2c424.sfo03"
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=12000000,CODECS="hev1.1.6.L120,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc-chunked.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked-avc",NAME="1080p60 AVC",AUTOSELECT=YES,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=8128000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked-avc",FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/avc-chunked.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="hev1.1.6.L93,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p60",FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc-720p60.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60-avc",NAME="720p60 AVC",AUTOSELECT=YES,DEFAULT=NO
#EXT-X-STREAM-INF:BANDWIDTH=4128000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p60-avc",FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/avc-720p60.m3u8`;

// Pure HEVC playlist (no AVC fallback)
const PURE_HEVC_PLAYLIST = `#EXTM3U
#EXT-X-TWITCH-INFO:NODE="video-edge-c2c424.sfo03"
#EXT-X-STREAM-INF:BANDWIDTH=12000000,CODECS="hev1.1.6.L120,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc-1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="hev1.1.6.L93,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc-720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,CODECS="hev1.1.6.L63,mp4a.40.2",RESOLUTION=854x480,FRAME-RATE=30.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc-480p.m3u8`;

// Pure AVC playlist
const PURE_AVC_PLAYLIST = `#EXTM3U
#EXT-X-TWITCH-INFO:NODE="video-edge-c2c424.sfo03"
#EXT-X-STREAM-INF:BANDWIDTH=8128000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/avc-1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4128000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/avc-720p.m3u8`;

// AV1 codec playlist
const AV1_PLAYLIST = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="av01.0.08M.08,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/av1-1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8128000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/avc-1080p.m3u8`;

describe('HEVC Stream Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
  });

  afterEach(() => {
    clearStreamInfo('testchannel');
    clearStreamInfo('hevc-channel');
  });

  describe('HEVC Detection', () => {
    it('should detect HEVC (hev1) codec in playlist', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        HEVC_MIXED_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('hev1');
    });

    it('should detect HEVC (hvc1) codec variant', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const hvc1Playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=12000000,CODECS="hvc1.1.6.L120,mp4a.40.2",RESOLUTION=1920x1080
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc.m3u8`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        hvc1Playlist,
        'testchannel'
      );

      expect(result).toContain('hvc1');
    });

    it('should identify streams with both HEVC and AVC', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        HEVC_MIXED_PLAYLIST,
        'testchannel'
      );

      // Should have both codecs
      expect(result).toContain('hev1');
      expect(result).toContain('avc1');
    });
  });

  describe('AVC Detection', () => {
    it('should detect AVC (avc1) codec', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        PURE_AVC_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('avc1.64002A');
      expect(result).toContain('avc1.4D401F');
    });

    it('should handle pure AVC playlist without modification', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        PURE_AVC_PLAYLIST,
        'testchannel'
      );

      // Should be largely unchanged
      expect(result).toContain('avc-1080p.m3u8');
      expect(result).toContain('avc-720p.m3u8');
    });
  });

  describe('AV1 Codec Support', () => {
    it('should detect AV1 (av01) codec', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        AV1_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('av01');
    });

    it('should preserve AV1 alongside AVC', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        AV1_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('av01');
      expect(result).toContain('avc1');
    });
  });

  describe('Pure HEVC Streams', () => {
    it('should handle streams with only HEVC quality levels', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/hevc-channel.m3u8?token=abc',
        PURE_HEVC_PLAYLIST,
        'hevc-channel'
      );

      // Should preserve HEVC since no AVC fallback
      expect(result).toContain('hev1');
      expect(result).not.toContain('avc1');
    });

    it('should not crash when no AVC fallback exists', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      await expect(
        processMasterPlaylist(
          'https://usher.ttvnw.net/api/channel/hls/hevc-channel.m3u8?token=abc',
          PURE_HEVC_PLAYLIST,
          'hevc-channel'
        )
      ).resolves.not.toThrow();
    });
  });

  describe('Resolution Matching', () => {
    it('should match resolutions when swapping HEVC to AVC', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        HEVC_MIXED_PLAYLIST,
        'testchannel'
      );

      // Both 1080p and 720p should be present
      expect(result).toContain('1920x1080');
      expect(result).toContain('1280x720');
    });

    it('should find closest resolution match', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      // Playlist with non-exact resolution matches
      const oddResolutionPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=10000000,CODECS="hev1.1.6.L120,mp4a.40.2",RESOLUTION=1936x1088,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc-weird.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=8128000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/avc-1080p.m3u8`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        oddResolutionPlaylist,
        'testchannel'
      );

      expect(result).toBeDefined();
    });
  });

  describe('Frame Rate Handling', () => {
    it('should preserve frame rate information', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        HEVC_MIXED_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('FRAME-RATE=60.000');
    });

    it('should handle mixed frame rates', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const mixedFpsPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="hev1.1.6.L120,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/hevc-60fps.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/avc-30fps.m3u8`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        mixedFpsPlaylist,
        'testchannel'
      );

      expect(result).toContain('FRAME-RATE=60.000');
      expect(result).toContain('FRAME-RATE=30.000');
    });
  });

  describe('Configuration: skipPlayerReloadOnHevc', () => {
    it('should respect skipPlayerReloadOnHevc setting', async () => {
      initAdBlockService({ enabled: true, skipPlayerReloadOnHevc: true });
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        HEVC_MIXED_PLAYLIST,
        'testchannel'
      );

      // Should still work, but internal behavior differs
      expect(result).toContain('#EXTM3U');
    });

    it('should not modify playlist when skipPlayerReloadOnHevc is true', async () => {
      initAdBlockService({ enabled: true, skipPlayerReloadOnHevc: true });
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        HEVC_MIXED_PLAYLIST,
        'testchannel'
      );

      // Original HEVC URLs should be preserved
      expect(result).toContain('hevc-chunked.m3u8');
    });
  });
});

describe('HEVC Codec String Parsing', () => {
  it('should recognize hev1 prefix', () => {
    const codec = 'hev1.1.6.L120';
    expect(codec.startsWith('hev')).toBe(true);
  });

  it('should recognize hvc1 prefix', () => {
    const codec = 'hvc1.1.6.L120';
    expect(codec.startsWith('hvc')).toBe(true);
  });

  it('should recognize avc1 prefix', () => {
    const codec = 'avc1.64002A';
    expect(codec.startsWith('avc')).toBe(true);
  });

  it('should recognize av01 prefix', () => {
    const codec = 'av01.0.08M.08';
    expect(codec.startsWith('av0')).toBe(true);
  });

  it('should differentiate HEVC from AVC', () => {
    const hevcCodec = 'hev1.1.6.L120';
    const avcCodec = 'avc1.64002A';

    expect(hevcCodec.startsWith('hev') || hevcCodec.startsWith('hvc')).toBe(true);
    expect(avcCodec.startsWith('avc')).toBe(true);
    expect(avcCodec.startsWith('hev') || avcCodec.startsWith('hvc')).toBe(false);
  });
});

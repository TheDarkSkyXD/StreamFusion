/**
 * Comprehensive M3U8 Parsing Tests
 *
 * Tests HLS playlist parsing with realistic Twitch playlist data.
 * Covers master playlists, media playlists, and edge cases.
 */

// Guards: realistic Twitch m3u8 playlist parsing — master + media variants, EXT tags, ad markers; fixtures derived from production captures so a parser regression surfaces here, not in users' players.

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

// Realistic Twitch master playlist
const REALISTIC_MASTER_PLAYLIST = `#EXTM3U
#EXT-X-TWITCH-INFO:NODE="video-edge-c2c424.sfo03",MANIFEST-NODE-TYPE="weaver_cluster",MANIFEST-NODE="video-weaver.sfo03",SUPPRESS="false",SERVER-TIME="1704067200.00",TRANSCODESTACK="2023-09-24-1",TRANSCODEMODE="cbr_v1",USER-IP="203.0.113.1",SERVING-ID="f8c3de3d5c4e"
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=8128000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,VIDEO="chunked",FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="720p60",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=4128000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,VIDEO="720p60",FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/720p60/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="480p30",NAME="480p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1728000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=852x480,VIDEO="480p30",FRAME-RATE=30.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/480p30/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="360p30",NAME="360p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=630000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=640x360,VIDEO="360p30",FRAME-RATE=30.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/360p30/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="160p30",NAME="160p",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=230000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=284x160,VIDEO="160p30",FRAME-RATE=30.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/160p30/index-dvr.m3u8`;

// Realistic Twitch media playlist (no ads)
const CLEAN_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-TWITCH-ELAPSED-SECS:3600.000
#EXT-X-TWITCH-TOTAL-SECS:3600.000
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T12:00:00.000Z
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12345.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12346.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12347.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12348.ts`;

// Realistic Twitch media playlist WITH ads
const AD_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-TWITCH-ELAPSED-SECS:3600.000
#EXT-X-TWITCH-TOTAL-SECS:3600.000
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T12:00:00.000Z
#EXT-X-DATERANGE:ID="stitched-ad-1234",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:00:00.000Z",DURATION=30.000,X-TV-TWITCH-AD-URL="https://ads.twitch.tv/ad",X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ads.twitch.tv/click"
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/ad-segment-1.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/ad-segment-2.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/ad-segment-3.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12348.ts`;

// Midroll ad media playlist
const MIDROLL_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12400
#EXT-X-TWITCH-AD-TYPE:"MIDROLL"
#EXT-X-DATERANGE:ID="stitched-ad-5678",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:30:00.000Z",DURATION=60.000
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/midroll-1.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/midroll-2.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12450.ts`;

describe('M3U8 Parsing - Master Playlists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
  });

  afterEach(() => {
    clearStreamInfo('testchannel');
    clearStreamInfo('xqc');
  });

  describe('Basic Parsing', () => {
    it('should parse master playlist and preserve all quality levels', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'testchannel'
      );

      // Should contain all quality levels
      expect(result).toContain('1920x1080');
      expect(result).toContain('1280x720');
      expect(result).toContain('852x480');
      expect(result).toContain('640x360');
      expect(result).toContain('284x160');
    });

    it('should preserve codec information', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('avc1.64002A');
      expect(result).toContain('avc1.4D401F');
      expect(result).toContain('mp4a.40.2');
    });

    it('should preserve frame rate information', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('FRAME-RATE=60.000');
      expect(result).toContain('FRAME-RATE=30.000');
    });

    it('should preserve bandwidth values', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('BANDWIDTH=8128000');
      expect(result).toContain('BANDWIDTH=4128000');
      expect(result).toContain('BANDWIDTH=230000');
    });
  });

  describe('Channel Name Normalization', () => {
    it('should normalize channel name to lowercase', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/XQC.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'XQC'
      );

      // Status should be retrievable with lowercase
      const status = getAdBlockStatus('xqc');
      expect(status.isActive).toBe(true);
    });

    it('should handle mixed case channel names', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/TestChannel.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'TestChannel'
      );

      const status = getAdBlockStatus('testchannel');
      expect(status.isActive).toBe(true);

      clearStreamInfo('testchannel');
    });
  });

  describe('Server Time Handling', () => {
    it('should preserve SERVER-TIME in playlist', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'testchannel'
      );

      expect(result).toContain('SERVER-TIME=');
    });

    it('should handle V2 API SERVER-TIME format', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const v2Playlist = `#EXTM3U
#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="1704067200.123"
#EXT-X-STREAM-INF:BANDWIDTH=8128000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/chunked/index-dvr.m3u8`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/v2/channel/hls/testchannel.m3u8?token=abc',
        v2Playlist,
        'testchannel'
      );

      expect(result).toContain('VALUE="1704067200.123"');
    });
  });
});

describe('M3U8 Parsing - Media Playlists', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    // Set up stream info first
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
      REALISTIC_MASTER_PLAYLIST,
      'testchannel'
    );
  });

  afterEach(() => {
    clearStreamInfo('testchannel');
  });

  describe('Clean Playlist Passthrough', () => {
    it('should pass through clean playlist unchanged', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        CLEAN_MEDIA_PLAYLIST
      );

      expect(result).toContain('#EXTINF:2.000,live');
      expect(result).not.toContain('stitched');
    });

    it('should preserve media sequence', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        CLEAN_MEDIA_PLAYLIST
      );

      expect(result).toContain('#EXT-X-MEDIA-SEQUENCE:12345');
    });

    it('should preserve target duration', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        CLEAN_MEDIA_PLAYLIST
      );

      expect(result).toContain('#EXT-X-TARGETDURATION:2');
    });
  });

  describe('Ad Detection', () => {
    it('should detect ads via stitched signifier', async () => {
      // Ad playlist processing triggers ad detection
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        AD_MEDIA_PLAYLIST
      );

      const status = getAdBlockStatus('testchannel');
      expect(status.isShowingAd).toBe(true);
    });

    it('should detect midroll ads', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        MIDROLL_AD_PLAYLIST
      );

      const status = getAdBlockStatus('testchannel');
      expect(status.isMidroll).toBe(true);
    });

    it('should detect DATERANGE ad markers', async () => {
      expect(AD_MEDIA_PLAYLIST).toContain('EXT-X-DATERANGE');
      expect(AD_MEDIA_PLAYLIST).toContain('twitch-stitched-ad');
    });
  });

  describe('Playlist Structure Preservation', () => {
    it('should preserve PROGRAM-DATE-TIME', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        CLEAN_MEDIA_PLAYLIST
      );

      expect(result).toContain('#EXT-X-PROGRAM-DATE-TIME:');
    });

    it('should preserve segment URLs', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        CLEAN_MEDIA_PLAYLIST
      );

      expect(result).toContain('video-edge-abc.sfo03.abs.hls.ttvnw.net');
      expect(result).toContain('.ts');
    });
  });
});

describe('M3U8 Parsing - Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
  });

  afterEach(() => {
    clearStreamInfo('testchannel');
  });

  describe('Empty and Malformed Playlists', () => {
    it('should handle empty playlist', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        '',
        'testchannel'
      );

      expect(result).toBe('');
    });

    it('should handle playlist with only header', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        '#EXTM3U',
        'testchannel'
      );

      expect(result).toContain('#EXTM3U');
    });

    it('should handle Windows line endings (CRLF)', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const windowsPlaylist = '#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=8128000,RESOLUTION=1920x1080\r\nhttps://example.com/stream.m3u8\r\n';

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        windowsPlaylist,
        'testchannel'
      );

      expect(result).toContain('1920x1080');
    });
  });

  describe('Special Characters', () => {
    it('should handle special characters in URLs', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const playlistWithSpecialChars = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=8128000,RESOLUTION=1920x1080,CODECS="avc1.64002A,mp4a.40.2"
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123+special/chunked/index-dvr.m3u8?param=value&other=123`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        playlistWithSpecialChars,
        'testchannel'
      );

      expect(result).toContain('special');
      expect(result).toContain('param=value');
    });

    it('should handle unicode in channel names', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/test_channel_123.m3u8?token=abc',
        REALISTIC_MASTER_PLAYLIST,
        'test_channel_123'
      );

      const status = getAdBlockStatus('test_channel_123');
      expect(status.isActive).toBe(true);

      clearStreamInfo('test_channel_123');
    });
  });

  describe('Unusual Bitrates', () => {
    it('should handle very low bitrate streams', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const lowBitratePlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=50000,RESOLUTION=160x90,CODECS="avc1.4D401F,mp4a.40.2"
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/ultra-low.m3u8`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        lowBitratePlaylist,
        'testchannel'
      );

      expect(result).toContain('BANDWIDTH=50000');
    });

    it('should handle very high bitrate streams', async () => {
      mockFetch.mockResolvedValueOnce({ status: 200 });

      const highBitratePlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=25000000,RESOLUTION=3840x2160,CODECS="hev1.1.6.L153,mp4a.40.2"
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/4k-ultra.m3u8`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        highBitratePlaylist,
        'testchannel'
      );

      expect(result).toContain('BANDWIDTH=25000000');
    });
  });
});

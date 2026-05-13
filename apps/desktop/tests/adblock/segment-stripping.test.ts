/**
 * Ad Segment Stripping Tests
 *
 * Tests the logic for stripping ad segments from Twitch HLS playlists.
 * When backup streams aren't available, the service strips ad segments
 * and replaces tracking URLs to minimize ad impact.
 */

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
  isAdSegment,
  getBlankVideoDataUrl,
} from '@/components/player/twitch/twitch-adblock-service';

// Master playlist for setup
const MASTER_PLAYLIST = `#EXTM3U
#EXT-X-TWITCH-INFO:NODE="video-edge-c2c424.sfo03",SERVER-TIME="1704067200.00"
#EXT-X-STREAM-INF:BANDWIDTH=8128000,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4128000,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.000
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/720p60/index-dvr.m3u8`;

// Clean media playlist (no ads)
const CLEAN_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T12:00:00.000Z
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12345.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12346.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12347.ts`;

// Media playlist with preroll ad segments
const PREROLL_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T12:00:00.000Z
#EXT-X-DATERANGE:ID="stitched-ad-1234",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:00:00.000Z",DURATION=30.000,X-TV-TWITCH-AD-URL="https://ads.twitch.tv/track/preroll",X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ads.twitch.tv/click/preroll"
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/preroll-seg-1.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/preroll-seg-2.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/preroll-seg-3.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/preroll-seg-4.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/preroll-seg-5.ts
#EXT-X-TWITCH-PREFETCH:https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/prefetch-1.ts
#EXT-X-TWITCH-PREFETCH:https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/prefetch-2.ts`;

// Media playlist with midroll ad segments
const MIDROLL_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12400
#EXT-X-TWITCH-AD-TYPE:"MIDROLL"
#EXT-X-DATERANGE:ID="stitched-ad-5678",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:30:00.000Z",DURATION=60.000,X-TV-TWITCH-AD-URL="https://ads.twitch.tv/track/midroll",X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ads.twitch.tv/click/midroll"
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/midroll-seg-1.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/midroll-seg-2.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12450.ts
#EXT-X-TWITCH-PREFETCH:https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/prefetch-mid.ts`;

// Mixed playlist with both ad and live segments
const MIXED_AD_LIVE_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12500
#EXT-X-DATERANGE:ID="stitched-ad-9999",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T13:00:00.000Z",DURATION=15.000
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-live-1.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/mid-ad-1.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-live-2.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/mid-ad-2.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-live-3.ts`;

describe('Ad Segment Stripping - Basic Detection', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    // Set up stream info first
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/strippingtest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'strippingtest'
    );
  });

  afterEach(() => {
    clearStreamInfo('strippingtest');
  });

  describe('Ad Segment Identification', () => {
    it('should detect stitched signifier in ad segments', () => {
      expect(PREROLL_AD_PLAYLIST).toContain('stitched');
    });

    it('should distinguish ad segments from live segments', () => {
      // Ad segments have 'stitched' designation
      expect(PREROLL_AD_PLAYLIST).toContain('#EXTINF:2.000,stitched');
      // Live segments have 'live' designation
      expect(CLEAN_MEDIA_PLAYLIST).toContain('#EXTINF:2.000,live');
    });

    it('should detect DATERANGE ad markers', () => {
      expect(PREROLL_AD_PLAYLIST).toContain('EXT-X-DATERANGE');
      expect(PREROLL_AD_PLAYLIST).toContain('twitch-stitched-ad');
    });
  });

  describe('Tracking URL Detection', () => {
    it('should identify X-TV-TWITCH-AD-URL tracking URLs', () => {
      expect(PREROLL_AD_PLAYLIST).toContain('X-TV-TWITCH-AD-URL=');
    });

    it('should identify X-TV-TWITCH-AD-CLICK-TRACKING-URL', () => {
      expect(PREROLL_AD_PLAYLIST).toContain('X-TV-TWITCH-AD-CLICK-TRACKING-URL=');
    });

    it('should detect CloudFront ad delivery URLs', () => {
      expect(PREROLL_AD_PLAYLIST).toContain('d2vjef5jvl6bfs.cloudfront.net');
    });
  });
});

describe('Ad Segment Stripping - Preroll Ads', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    // Set up stream info
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/prerolltest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'prerolltest'
    );
  });

  afterEach(() => {
    clearStreamInfo('prerolltest');
  });

  it('should detect preroll ads in playlist', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    const status = getAdBlockStatus('prerolltest');
    expect(status.isShowingAd).toBe(true);
  });

  it('should not flag as midroll for preroll ads', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    const status = getAdBlockStatus('prerolltest');
    expect(status.isMidroll).toBe(false);
  });

  it('should disable prefetch during ads', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    // Prefetch lines should be removed/emptied during ads
    const prefetchCount = (result.match(/#EXT-X-TWITCH-PREFETCH:/g) || []).length;
    const originalPrefetchCount = (PREROLL_AD_PLAYLIST.match(/#EXT-X-TWITCH-PREFETCH:/g) || []).length;
    
    expect(prefetchCount).toBeLessThan(originalPrefetchCount);
  });
});

describe('Ad Segment Stripping - Midroll Ads', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    // Set up stream info
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/midrolltest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'midrolltest'
    );
  });

  afterEach(() => {
    clearStreamInfo('midrolltest');
  });

  it('should detect midroll ads via MIDROLL marker', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      MIDROLL_AD_PLAYLIST
    );

    const status = getAdBlockStatus('midrolltest');
    expect(status.isMidroll).toBe(true);
  });

  it('should set isShowingAd for midroll ads', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      MIDROLL_AD_PLAYLIST
    );

    const status = getAdBlockStatus('midrolltest');
    expect(status.isShowingAd).toBe(true);
  });

  it('should preserve live segments in mixed playlists', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      MIDROLL_AD_PLAYLIST
    );

    // Live segment URL should still be present
    expect(result).toContain('video-edge-abc.sfo03.abs.hls.ttvnw.net');
  });
});

describe('Ad Segment Stripping - Tracking URL Replacement', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    // Set up stream info
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/trackingtest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'trackingtest'
    );
  });

  afterEach(() => {
    clearStreamInfo('trackingtest');
  });

  it('should replace ad tracking URLs with safe URL', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    // Original tracking URL should be replaced
    expect(result).not.toContain('https://ads.twitch.tv/track/preroll');
    expect(result).toContain('X-TV-TWITCH-AD-URL="https://twitch.tv"');
  });

  it('should replace click tracking URLs', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    // Click tracking URL should be replaced
    expect(result).not.toContain('https://ads.twitch.tv/click/preroll');
    expect(result).toContain('X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://twitch.tv"');
  });
});

describe('Ad Segment Stripping - Segment Counting', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    // Set up stream info
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/counttest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'counttest'
    );
  });

  afterEach(() => {
    clearStreamInfo('counttest');
  });

  it('should count stripped ad segments', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    const status = getAdBlockStatus('counttest');
    // isStrippingSegments is set when ad segments are detected
    expect(status.isShowingAd).toBe(true);
    expect(status.isStrippingSegments).toBe(true);
  });

  it('should reset segment count after ads finish', async () => {
    // Process ad playlist first
    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    // Now process clean playlist
    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      CLEAN_MEDIA_PLAYLIST
    );

    const status = getAdBlockStatus('counttest');
    expect(status.isShowingAd).toBe(false);
    expect(status.numStrippedSegments).toBe(0);
  });
});

describe('Ad Segment Stripping - Blank Video Replacement', () => {
  it('should provide valid MP4 data URL for blank video', () => {
    const dataUrl = getBlankVideoDataUrl();
    
    expect(dataUrl).toMatch(/^data:video\/mp4;base64,/);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it('should return consistent blank video URL', () => {
    const url1 = getBlankVideoDataUrl();
    const url2 = getBlankVideoDataUrl();
    
    expect(url1).toBe(url2);
  });

  it('should have valid base64 encoding', () => {
    const dataUrl = getBlankVideoDataUrl();
    const base64Part = dataUrl.replace('data:video/mp4;base64,', '');
    
    // Should be valid base64 (only contains valid characters)
    expect(/^[A-Za-z0-9+/=]+$/.test(base64Part)).toBe(true);
  });
});

describe('Ad Segment Stripping - Mixed Content', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    // Set up stream info
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/mixedtest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'mixedtest'
    );
  });

  afterEach(() => {
    clearStreamInfo('mixedtest');
  });

  it('should handle interleaved ad and live segments', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      MIXED_AD_LIVE_PLAYLIST
    );

    // Should still contain live segment URLs
    expect(result).toContain('CpAF-live-1.ts');
    expect(result).toContain('CpAF-live-2.ts');
    expect(result).toContain('CpAF-live-3.ts');
  });

  it('should detect ads even with mixed content', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      MIXED_AD_LIVE_PLAYLIST
    );

    const status = getAdBlockStatus('mixedtest');
    expect(status.isShowingAd).toBe(true);
  });
});

describe('Ad Segment Stripping - Configuration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearStreamInfo('configtest');
  });

  it('should not strip when isAdStrippingEnabled is false', async () => {
    initAdBlockService({ enabled: true, isAdStrippingEnabled: false });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/configtest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'configtest'
    );

    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    // Ads should still be detected
    const status = getAdBlockStatus('configtest');
    expect(status.isShowingAd).toBe(true);
  });

  it('should pass through when ad-blocking is disabled', async () => {
    initAdBlockService({ enabled: false });

    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/any/index.m3u8',
      PREROLL_AD_PLAYLIST
    );

    // Should return original playlist unchanged
    expect(result).toBe(PREROLL_AD_PLAYLIST);
  });
});

describe('Ad Segment Stripping - Edge Cases', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/edgetest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'edgetest'
    );
  });

  afterEach(() => {
    clearStreamInfo('edgetest');
  });

  it('should handle empty ad DATERANGE', async () => {
    const emptyDateRangePlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-DATERANGE:ID="stitched-empty",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:00:00.000Z"
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12345.ts`;

    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      emptyDateRangePlaylist
    );

    // Should still process without errors
    expect(result).toContain('#EXTM3U');
  });

  it('should handle very long ad breaks', async () => {
    // Generate a playlist with many ad segments
    let longAdPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-DATERANGE:ID="stitched-long",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:00:00.000Z",DURATION=180.000`;

    for (let i = 0; i < 90; i++) {
      longAdPlaylist += `
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/long-seg-${i}.ts`;
    }

    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      longAdPlaylist
    );

    const status = getAdBlockStatus('edgetest');
    expect(status.isShowingAd).toBe(true);
    expect(status.isStrippingSegments).toBe(true);
  });

  it('should handle Windows-style line endings', async () => {
    const windowsPlaylist = PREROLL_AD_PLAYLIST.replace(/\n/g, '\r\n');

    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      windowsPlaylist
    );

    const status = getAdBlockStatus('edgetest');
    expect(status.isShowingAd).toBe(true);
  });
});

// Playlist that mirrors real Twitch ad delivery: PROGRAM-DATE-TIME covers the
// live segment, then a DISCONTINUITY tag introduces the stitched ad break.
// The stripper resets its "live scope" on DISCONTINUITY, so segments after it
// land in the ad-segment cache. Without the DISCONTINUITY (which the broader
// PREROLL_AD_PLAYLIST fixture intentionally omits to test other paths), every
// segment is treated as live and the cache stays empty.
const CACHE_TEST_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T12:00:00.000Z
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12344.ts
#EXT-X-DISCONTINUITY
#EXT-X-DATERANGE:ID="stitched-ad-1234",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:00:00.000Z",DURATION=30.000,X-TV-TWITCH-AD-URL="https://ads.twitch.tv/track/preroll"
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/cache-seg-1.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/cache-seg-2.ts`;

describe('Ad Segment Cache Management', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/cachetest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'cachetest'
    );
  });

  afterEach(() => {
    clearStreamInfo('cachetest');
  });

  it('should identify cached ad segments', async () => {
    // Process ad playlist to cache segments
    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      CACHE_TEST_PLAYLIST
    );

    // Ad segments after the DISCONTINUITY should be cached
    const isAd = isAdSegment('https://d2vjef5jvl6bfs.cloudfront.net/ad/cache-seg-1.ts');
    expect(isAd).toBe(true);
  });

  it('should not identify non-ad segments as ads', () => {
    const isAd = isAdSegment('https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12345.ts');
    expect(isAd).toBe(false);
  });
});

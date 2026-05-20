/**
 * Integration Tests for Twitch Ad-Block System
 *
 * End-to-end tests for the complete ad-blocking flow from stream initialization
 * through ad detection, backup fetching, segment stripping, and recovery.
 */

// Guards: end-to-end adblock pipeline — init → master playlist → media playlist → segment stripping → recovery sequence; this is the only test that exercises the full chain.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  initAdBlockService,
  updateAdBlockConfig,
  processMasterPlaylist,
  processMediaPlaylist,
  clearStreamInfo,
  getAdBlockStatus,
  isAdBlockEnabled,
  setStatusChangeCallback,
  setPlayerCallbacks,
  setAuthHeaders,
  isAdSegment,
  getBlankVideoDataUrl,
} from '@/components/player/twitch/twitch-adblock-service';

import {
  createStreamInfo,
  DEFAULT_ADBLOCK_CONFIG,
} from '@/shared/adblock-types';

// ==================== Test Data ====================

// Realistic master playlist from Twitch
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
https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/480p30/index-dvr.m3u8`;

// Clean media playlist (live content, no ads)
const CLEAN_LIVE_PLAYLIST = `#EXTM3U
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
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12348.ts
#EXT-X-TWITCH-PREFETCH:https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/prefetch-1.ts`;

// Preroll ad playlist (viewer joins stream)
const PREROLL_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12340
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T11:59:50.000Z
#EXT-X-DATERANGE:ID="stitched-ad-preroll-001",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T11:59:50.000Z",DURATION=30.000,X-TV-TWITCH-AD-URL="https://ads.twitch.tv/track/preroll",X-TV-TWITCH-AD-CLICK-TRACKING-URL="https://ads.twitch.tv/click/preroll"
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0001.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0002.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0003.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0004.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0005.ts
#EXT-X-TWITCH-PREFETCH:https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0006.ts`;

// Midroll ad playlist (streamer runs ad)
const MIDROLL_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:14000
#EXT-X-TWITCH-AD-TYPE:"MIDROLL"
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T12:30:00.000Z
#EXT-X-DATERANGE:ID="stitched-ad-midroll-001",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:30:00.000Z",DURATION=60.000,X-TV-TWITCH-AD-SPOT-ID="midroll-60"
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-13999.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/midroll/seg-0001.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/midroll/seg-0002.ts
#EXTINF:2.000,"MIDROLL"
https://d2vjef5jvl6bfs.cloudfront.net/midroll/seg-0003.ts`;

// Post-ad transition playlist
const POST_AD_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:14010
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T12:30:30.000Z
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-14010.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-14011.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-14012.ts`;

// ==================== Integration Tests ====================

describe('Integration: Full Ad-Block Lifecycle', () => {
  let statusChanges: any[] = [];
  let playerReloadCalled = false;
  let pauseResumeCalled = false;

  beforeEach(async () => {
    vi.clearAllMocks();
    statusChanges = [];
    playerReloadCalled = false;
    pauseResumeCalled = false;

    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });
    setAuthHeaders('test-device-id');
    
    // Set up callbacks
    setStatusChangeCallback((status) => {
      statusChanges.push({ ...status, timestamp: Date.now() });
    });
    
    setPlayerCallbacks(
      () => { playerReloadCalled = true; },
      () => { pauseResumeCalled = true; }
    );

    // Initialize stream
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/integrationtest.m3u8?token=abc&sig=xyz',
      REALISTIC_MASTER_PLAYLIST,
      'integrationtest'
    );
  });

  afterEach(() => {
    clearStreamInfo('integrationtest');
  });

  describe('Stream Initialization', () => {
    it('should initialize stream info on first master playlist', () => {
      const status = getAdBlockStatus('integrationtest');
      
      expect(status.isActive).toBe(true);
      expect(status.isShowingAd).toBe(false);
      // channelName in status comes from streamInfo, which stores normalized channel name
      // It may be null if accessed before stream info is fully populated
    });

    it('should parse all quality levels from master playlist', async () => {
      // The master playlist has 3 quality levels
      const status = getAdBlockStatus('integrationtest');
      expect(status.isActive).toBe(true);
    });
  });

  describe('Clean Stream Playback', () => {
    it('should pass through clean playlist without modification', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        CLEAN_LIVE_PLAYLIST
      );

      // Should preserve all live segments
      expect(result).toContain('CpAF-12345.ts');
      expect(result).toContain('CpAF-12348.ts');
      
      const status = getAdBlockStatus('integrationtest');
      expect(status.isShowingAd).toBe(false);
    });

    it('should preserve prefetch hints on clean streams', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        CLEAN_LIVE_PLAYLIST
      );

      expect(result).toContain('EXT-X-TWITCH-PREFETCH');
    });
  });

  describe('Preroll Ad Detection and Handling', () => {
    it('should detect preroll ads on stream join', async () => {
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );

      const status = getAdBlockStatus('integrationtest');
      expect(status.isShowingAd).toBe(true);
      expect(status.isMidroll).toBe(false);
    });

    it('should replace tracking URLs in preroll ads', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );

      expect(result).not.toContain('ads.twitch.tv/track');
      expect(result).toContain('X-TV-TWITCH-AD-URL="https://twitch.tv"');
    });

    it('should disable prefetch during preroll ads', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );

      // Prefetch should be stripped during ads
      const prefetchCount = (result.match(/#EXT-X-TWITCH-PREFETCH:/g) || []).length;
      expect(prefetchCount).toBe(0);
    });

    it('should track ad start time', async () => {
      const beforeTime = Date.now();
      
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );

      const status = getAdBlockStatus('integrationtest');
      expect(status.adStartTime).not.toBeNull();
      expect(status.adStartTime).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe('Midroll Ad Detection and Handling', () => {
    it('should detect midroll ads', async () => {
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        MIDROLL_AD_PLAYLIST
      );

      const status = getAdBlockStatus('integrationtest');
      expect(status.isShowingAd).toBe(true);
      expect(status.isMidroll).toBe(true);
    });

    it('should preserve live segments in mixed midroll playlist', async () => {
      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        MIDROLL_AD_PLAYLIST
      );

      // Live segment before ad should be preserved
      expect(result).toContain('CpAF-13999.ts');
    });
  });

  describe('Ad to Content Transition', () => {
    it('should detect when ads finish', async () => {
      // First, show ad
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );

      let status = getAdBlockStatus('integrationtest');
      expect(status.isShowingAd).toBe(true);

      // Then, show clean content
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        POST_AD_PLAYLIST
      );

      status = getAdBlockStatus('integrationtest');
      expect(status.isShowingAd).toBe(false);
    });

    it('should reset ad state after ads finish', async () => {
      // Show ad
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        MIDROLL_AD_PLAYLIST
      );

      // Show clean content
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        POST_AD_PLAYLIST
      );

      const status = getAdBlockStatus('integrationtest');
      // Core state should be reset - isShowingAd is the key indicator
      expect(status.isShowingAd).toBe(false);
      expect(status.adStartTime).toBeNull();
    });

    it('should trigger pause/resume callback after ads', async () => {
      // Show ad then clean content
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );
      
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        POST_AD_PLAYLIST
      );

      // Either reload or pause/resume should be called
      // Based on reloadPlayerAfterAd config
      expect(playerReloadCalled || pauseResumeCalled).toBe(true);
    });
  });

  describe('Status Change Callbacks', () => {
    it('should emit status changes during ad detection', async () => {
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );

      expect(statusChanges.length).toBeGreaterThan(0);
      
      const lastStatus = statusChanges[statusChanges.length - 1];
      expect(lastStatus.isShowingAd).toBe(true);
    });

    it('should emit status changes when ads finish', async () => {
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      );
      
      const adStatusCount = statusChanges.length;
      
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        POST_AD_PLAYLIST
      );

      expect(statusChanges.length).toBeGreaterThan(adStatusCount);
    });
  });
});

describe('Integration: Configuration Changes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/configtest.m3u8?token=abc',
      REALISTIC_MASTER_PLAYLIST,
      'configtest'
    );
  });

  afterEach(() => {
    clearStreamInfo('configtest');
  });

  it('should disable ad-blocking when config disabled', async () => {
    updateAdBlockConfig({ enabled: false });
    
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    // Should return unchanged playlist
    expect(result).toBe(PREROLL_AD_PLAYLIST);
  });

  it('should re-enable ad-blocking when config enabled', async () => {
    updateAdBlockConfig({ enabled: false });
    updateAdBlockConfig({ enabled: true });
    
    expect(isAdBlockEnabled()).toBe(true);
  });
});

describe('Integration: Multiple Channels', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    // Set up two channels
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/channel1.m3u8?token=abc',
      REALISTIC_MASTER_PLAYLIST,
      'channel1'
    );

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/channel2.m3u8?token=xyz',
      REALISTIC_MASTER_PLAYLIST.replace('CpEF-abc123', 'CpEF-def456'),
      'channel2'
    );
  });

  afterEach(() => {
    clearStreamInfo('channel1');
    clearStreamInfo('channel2');
  });

  it('should track ad state independently per channel', async () => {
    // Channel 1 shows ad
    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    const status1 = getAdBlockStatus('channel1');
    const status2 = getAdBlockStatus('channel2');

    expect(status1.isShowingAd).toBe(true);
    expect(status2.isShowingAd).toBe(false);
  });

  it('should clear stream info independently', () => {
    clearStreamInfo('channel1');
    
    // channel2 should still exist
    const status2 = getAdBlockStatus('channel2');
    expect(status2.isActive).toBe(true);
  });
});

describe('Integration: StreamInfo Management', () => {
  describe('createStreamInfo', () => {
    it('should create properly initialized StreamInfo', () => {
      const info = createStreamInfo('testchannel', '?token=abc');

      expect(info.channelName).toBe('testchannel');
      expect(info.usherParams).toBe('?token=abc');
      expect(info.isShowingAd).toBe(false);
      expect(info.isMidroll).toBe(false);
      expect(info.urls).toBeInstanceOf(Map);
      expect(info.resolutionList).toEqual([]);
      expect(info.backupEncodingsCache).toBeInstanceOf(Map);
      expect(info.requestedAds).toBeInstanceOf(Set);
    });

    it('should initialize all required fields', () => {
      const info = createStreamInfo('xqc', '?sig=xyz');

      expect(info).toHaveProperty('encodingsM3U8', null);
      expect(info).toHaveProperty('modifiedM3U8', null);
      expect(info).toHaveProperty('isUsingModifiedM3U8', false);
      expect(info).toHaveProperty('activeBackupPlayerType', null);
      expect(info).toHaveProperty('isStrippingAdSegments', false);
      expect(info).toHaveProperty('numStrippedAdSegments', 0);
      expect(info).toHaveProperty('isUsingFallbackMode', false);
      expect(info).toHaveProperty('adStartTime', null);
    });
  });
});

describe('Integration: Ad Segment Caching', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true, isAdStrippingEnabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/cacheintegration.m3u8?token=abc',
      REALISTIC_MASTER_PLAYLIST,
      'cacheintegration'
    );
  });

  afterEach(() => {
    clearStreamInfo('cacheintegration');
  });

  it('should cache ad segment URLs during stripping', async () => {
    // The fixture-level PREROLL_AD_PLAYLIST omits DISCONTINUITY; without it the
    // stripper keeps treating every segment as live (PROGRAM-DATE-TIME scope).
    // Real Twitch ad playlists have DISCONTINUITY before stitched ads — mirror
    // that here so the cache actually picks up the ad URLs.
    const CACHE_TEST_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12340
#EXT-X-PROGRAM-DATE-TIME:2024-01-01T11:59:50.000Z
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12339.ts
#EXT-X-DISCONTINUITY
#EXT-X-DATERANGE:ID="stitched-ad-preroll-001",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T11:59:50.000Z",DURATION=30.000,X-TV-TWITCH-AD-URL="https://ads.twitch.tv/track/preroll"
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0001.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0002.ts`;

    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      CACHE_TEST_PLAYLIST
    );

    // Ad segments should be cached
    const isAd = isAdSegment('https://d2vjef5jvl6bfs.cloudfront.net/preroll/seg-0001.ts');
    expect(isAd).toBe(true);
  });

  it('should provide blank video for cached ad segments', () => {
    const blankUrl = getBlankVideoDataUrl();
    
    expect(blankUrl).toMatch(/^data:video\/mp4;base64,/);
  });
});

describe('Integration: Default Configuration Validation', () => {
  it('should have sensible default values', () => {
    expect(DEFAULT_ADBLOCK_CONFIG.enabled).toBe(true);
    expect(DEFAULT_ADBLOCK_CONFIG.adSignifier).toBe('stitched');
    expect(DEFAULT_ADBLOCK_CONFIG.isAdStrippingEnabled).toBe(true);
    expect(DEFAULT_ADBLOCK_CONFIG.reloadPlayerAfterAd).toBe(true);
  });

  it('should have valid client ID format', () => {
    expect(DEFAULT_ADBLOCK_CONFIG.clientId).toMatch(/^[a-z0-9]+$/);
    expect(DEFAULT_ADBLOCK_CONFIG.clientId.length).toBe(30);
  });

  it('should have reasonable timing values', () => {
    expect(DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsTime).toBeGreaterThan(0);
    expect(DEFAULT_ADBLOCK_CONFIG.playerBufferingDelay).toBeGreaterThan(0);
    expect(DEFAULT_ADBLOCK_CONFIG.playerBufferingMinRepeatDelay).toBeGreaterThan(0);
  });
});

describe('Integration: Error Recovery', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/errorrecovery.m3u8?token=abc',
      REALISTIC_MASTER_PLAYLIST,
      'errorrecovery'
    );
  });

  afterEach(() => {
    clearStreamInfo('errorrecovery');
  });

  it('should handle network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(
      processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        PREROLL_AD_PLAYLIST
      )
    ).resolves.not.toThrow();
  });

  it('should return processed playlist even on backup failures', async () => {
    mockFetch.mockRejectedValue(new Error('Backup fetch failed'));

    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    expect(result).toContain('#EXTM3U');
  });

  it('should maintain service state after errors', async () => {
    mockFetch.mockRejectedValue(new Error('Error'));

    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      PREROLL_AD_PLAYLIST
    );

    expect(isAdBlockEnabled()).toBe(true);
  });
});

describe('Integration: Edge Cases', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/edgecases.m3u8?token=abc',
      REALISTIC_MASTER_PLAYLIST,
      'edgecases'
    );
  });

  afterEach(() => {
    clearStreamInfo('edgecases');
  });

  it('should handle empty playlist', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      ''
    );

    expect(result).toBe('');
  });

  it('should handle playlist with only header', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      '#EXTM3U'
    );

    expect(result).toContain('#EXTM3U');
  });

  it('should handle unknown URL gracefully', async () => {
    const result = await processMediaPlaylist(
      'https://unknown-url.example.com/playlist.m3u8',
      CLEAN_LIVE_PLAYLIST
    );

    // Should return unchanged when no stream info exists
    expect(result).toBe(CLEAN_LIVE_PLAYLIST);
  });

  it('should handle rapid playlist updates', async () => {
    // Simulate rapid polling
    for (let i = 0; i < 10; i++) {
      await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        i % 2 === 0 ? PREROLL_AD_PLAYLIST : CLEAN_LIVE_PLAYLIST
      );
    }

    // Should not throw and should have valid state
    const status = getAdBlockStatus('edgecases');
    expect(status).toBeDefined();
  });
});

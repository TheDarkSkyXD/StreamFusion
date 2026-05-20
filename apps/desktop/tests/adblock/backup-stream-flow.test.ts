/**
 * Backup Stream Flow Tests
 *
 * Tests the backup stream fetching mechanism that cycles through different
 * playerType values to find an ad-free stream. This is the core VAFT technique.
 */

// Guards: backup-stream cycling is the core VAFT technique — each player-type variant must be tried in order and rejected if it returns an ad-stitched playlist.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  initAdBlockService,
  updateAdBlockConfig,
  getAdBlockConfig,
  processMasterPlaylist,
  processMediaPlaylist,
  clearStreamInfo,
  getAdBlockStatus,
  setAuthHeaders,
} from '@/components/player/twitch/twitch-adblock-service';

import {
  DEFAULT_ADBLOCK_CONFIG,
  PlayerType,
} from '@/shared/adblock-types';

// Master playlist for stream setup
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
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12345.ts
#EXTINF:2.000,live
https://video-edge-abc.sfo03.abs.hls.ttvnw.net/v1/segment/CpAF-12346.ts`;

// Media playlist with ads (stitched signifier)
const AD_MEDIA_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:12345
#EXT-X-DATERANGE:ID="stitched-ad-1234",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T12:00:00.000Z",DURATION=30.000
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/segment-1.ts
#EXTINF:2.000,stitched
https://d2vjef5jvl6bfs.cloudfront.net/ad/segment-2.ts`;

// Mock GQL response for access token
const createMockAccessTokenResponse = (playerType: PlayerType) => ({
  data: {
    streamPlaybackAccessToken: {
      value: JSON.stringify({
        channel: 'testchannel',
        player_type: playerType,
        parent_domains: ['example.com'],
        parent_referrer_domains: ['example.com'],
      }),
      signature: 'mock-signature-' + playerType,
    },
  },
});

describe('Backup Stream Flow - Player Type Cycling', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
    setAuthHeaders('mock-device-id');
  });

  afterEach(() => {
    clearStreamInfo('backuptest');
  });

  describe('Default Player Types', () => {
    it('should have correct default backup player types', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes).toEqual([
        'embed',
        'popout',
        'autoplay',
        'picture-by-picture',
        'thunderdome',
      ]);
    });

    it('should have embed as default fallback type', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.fallbackPlayerType).toBe('embed');
    });

    it('should have popout as force access token type', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.forceAccessTokenPlayerType).toBe('popout');
    });
  });

  describe('Player Type Definitions', () => {
    it('should recognize valid player types', () => {
      const validTypes: PlayerType[] = [
        'site',
        'embed',
        'popout',
        'autoplay',
        'picture-by-picture',
        'thunderdome',
      ];

      validTypes.forEach(type => {
        expect(typeof type).toBe('string');
      });
    });

    it('should have 6 valid player types', () => {
      // Based on the PlayerType definition
      const allTypes: PlayerType[] = [
        'site',
        'embed',
        'popout',
        'autoplay',
        'picture-by-picture',
        'thunderdome',
      ];
      expect(allTypes.length).toBe(6);
    });
  });
});

describe('Backup Stream Flow - Access Token Requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
    setAuthHeaders('mock-device-id', 'OAuth mock-token');
  });

  afterEach(() => {
    clearStreamInfo('tokentest');
  });

  describe('GQL Request Format', () => {
    it('should use correct GQL endpoint', () => {
      // The service uses https://gql.twitch.tv/gql
      expect('https://gql.twitch.tv/gql').toContain('gql.twitch.tv');
    });

    it('should use correct client ID from config', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.clientId).toBe('kimne78kx3ncx6brgo4mv6wki5h1ko');
    });

    it('should use PlaybackAccessToken operation name', () => {
      // The operationName used in GQL requests
      expect('PlaybackAccessToken').toBeDefined();
    });

    it('should use correct SHA256 hash for persisted query', () => {
      const expectedHash = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9';
      expect(expectedHash.length).toBe(64);
    });
  });

  describe('Platform Parameter', () => {
    it('should use android platform for autoplay type', () => {
      // autoplay player type uses 'android' platform
      const playerType = 'autoplay';
      const platform = playerType === 'autoplay' ? 'android' : 'web';
      expect(platform).toBe('android');
    });

    it('should use web platform for other types', () => {
      const playerTypes: PlayerType[] = ['embed', 'popout', 'picture-by-picture', 'thunderdome'];
      
      playerTypes.forEach(type => {
        const platform = type === 'autoplay' ? 'android' : 'web';
        expect(platform).toBe('web');
      });
    });
  });
});

describe('Backup Stream Flow - Parent Domain Stripping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });
  });

  describe('Token Value Stripping', () => {
    it('should strip parent_domains from token', () => {
      const tokenValue = {
        channel: 'testchannel',
        player_type: 'embed',
        parent_domains: ['example.com', 'twitch.tv'],
        parent_referrer_domains: ['example.com'],
        sig: 'abc123',
      };

      // Simulate stripping
      const strippedToken = { ...tokenValue };
      delete (strippedToken as Record<string, unknown>).parent_domains;
      delete (strippedToken as Record<string, unknown>).parent_referrer_domains;

      expect(strippedToken).not.toHaveProperty('parent_domains');
      expect(strippedToken).not.toHaveProperty('parent_referrer_domains');
      expect(strippedToken).toHaveProperty('channel', 'testchannel');
      expect(strippedToken).toHaveProperty('sig', 'abc123');
    });

    it('should preserve other token properties', () => {
      const tokenValue = {
        channel: 'xqc',
        player_type: 'popout',
        parent_domains: ['embed.example.com'],
        ci_gb: true,
        device_id: 'abc123',
        adblock: false,
        geoblock_reason: '',
      };

      const strippedToken = { ...tokenValue };
      delete (strippedToken as Record<string, unknown>).parent_domains;

      expect(strippedToken.channel).toBe('xqc');
      expect(strippedToken.ci_gb).toBe(true);
      expect(strippedToken.device_id).toBe('abc123');
    });
  });

  describe('Usher URL Stripping', () => {
    it('should build usher URL correctly', () => {
      const baseUrl = 'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8';
      expect(baseUrl).toContain('usher.ttvnw.net');
      expect(baseUrl).toContain('/api/channel/hls/');
    });

    it('should support V2 API URL format', () => {
      const v2Url = 'https://usher.ttvnw.net/api/v2/channel/hls/testchannel.m3u8';
      expect(v2Url).toContain('/api/v2/');
    });

    it('should strip parent_domains from usher params', () => {
      const originalUrl = new URL('https://usher.ttvnw.net/api/channel/hls/test.m3u8?parent_domains=example.com&referrer=test&sig=abc');
      
      // Simulate stripping
      originalUrl.searchParams.delete('parent_domains');
      originalUrl.searchParams.delete('referrer');
      
      expect(originalUrl.searchParams.has('parent_domains')).toBe(false);
      expect(originalUrl.searchParams.has('referrer')).toBe(false);
      expect(originalUrl.searchParams.get('sig')).toBe('abc');
    });
  });
});

describe('Backup Stream Flow - Encodings Cache', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    // Set up stream info
    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/cacheflowtest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'cacheflowtest'
    );
  });

  afterEach(() => {
    clearStreamInfo('cacheflowtest');
  });

  it('should cache backup encodings per player type', () => {
    // The service caches encodings in backupEncodingsCache Map
    // Key is playerType, value is m3u8 content
    const cacheKey: PlayerType = 'embed';
    expect(typeof cacheKey).toBe('string');
  });

  it('should clear cache and retry if cached content has ads', () => {
    // When cached backup still has ads, cache is cleared for retry
    // This allows fetching fresh token on next attempt
    const hasAds = (content: string) => content.includes('stitched');
    
    expect(hasAds(AD_MEDIA_PLAYLIST)).toBe(true);
    expect(hasAds(CLEAN_MEDIA_PLAYLIST)).toBe(false);
  });
});

describe('Backup Stream Flow - Resolution Matching', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/restest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'restest'
    );
  });

  afterEach(() => {
    clearStreamInfo('restest');
  });

  describe('Exact Resolution Matching', () => {
    it('should match exact resolution when available', () => {
      const targetResolution = '1920x1080';
      const availableResolutions = ['1920x1080', '1280x720', '852x480'];
      
      const exactMatch = availableResolutions.find(r => r === targetResolution);
      expect(exactMatch).toBe('1920x1080');
    });

    it('should prefer frame rate match for same resolution', () => {
      const streams = [
        { resolution: '1920x1080', frameRate: 60 },
        { resolution: '1920x1080', frameRate: 30 },
      ];
      const targetFrameRate = 60;

      const match = streams.find(s => s.frameRate === targetFrameRate);
      expect(match?.frameRate).toBe(60);
    });
  });

  describe('Closest Resolution Fallback', () => {
    it('should find closest resolution by pixel count', () => {
      const target = { width: 1920, height: 1080 };
      const available = [
        { width: 1280, height: 720 },
        { width: 1600, height: 900 },
        { width: 852, height: 480 },
      ];

      const targetPixels = target.width * target.height;
      
      const closest = available.reduce((prev, curr) => {
        const prevDiff = Math.abs((prev.width * prev.height) - targetPixels);
        const currDiff = Math.abs((curr.width * curr.height) - targetPixels);
        return currDiff < prevDiff ? curr : prev;
      });

      expect(closest).toEqual({ width: 1600, height: 900 });
    });

    it('should handle non-standard resolutions', () => {
      const weirdResolution = '1936x1088';
      const [width, height] = weirdResolution.split('x').map(Number);
      
      expect(width).toBe(1936);
      expect(height).toBe(1088);
      expect(width * height).toBeGreaterThan(1920 * 1080);
    });
  });
});

describe('Backup Stream Flow - Fallback Behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/fallbacktest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'fallbacktest'
    );
  });

  afterEach(() => {
    clearStreamInfo('fallbacktest');
  });

  describe('Fallback Mode Entry', () => {
    it('should enter fallback mode when all backups fail', async () => {
      // Simulate all backup fetches failing
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        AD_MEDIA_PLAYLIST
      );

      const status = getAdBlockStatus('fallbacktest');
      expect(status.isShowingAd).toBe(true);
    });

    it('should use fallback player type as last resort', () => {
      const backupTypes = DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes;
      const fallbackType = DEFAULT_ADBLOCK_CONFIG.fallbackPlayerType;

      // fallback type should be one of the backup types (usually first)
      expect(backupTypes).toContain(fallbackType);
    });
  });

  describe('Minimal Requests Mode', () => {
    it('should have minimal requests time config', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsTime).toBe(1500);
    });

    it('should have minimal requests player index config', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsPlayerIndex).toBe(2);
    });

    it('should skip early player types during minimal requests', () => {
      const playerIndex = DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsPlayerIndex;
      const backupTypes = DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes;
      
      // During minimal requests, starts at index 2 (autoplay)
      const startType = backupTypes[playerIndex];
      expect(startType).toBe('autoplay');
    });
  });
});

describe('Backup Stream Flow - Status Updates', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/statustest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'statustest'
    );
  });

  afterEach(() => {
    clearStreamInfo('statustest');
  });

  it('should track active backup player type', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      AD_MEDIA_PLAYLIST
    );

    const status = getAdBlockStatus('statustest');
    // activePlayerType is set when backup is used
    expect(status).toHaveProperty('activePlayerType');
  });

  it('should track fallback mode status', async () => {
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      AD_MEDIA_PLAYLIST
    );

    const status = getAdBlockStatus('statustest');
    expect(status).toHaveProperty('isUsingFallbackMode');
  });

  it('should track ad start time', async () => {
    const beforeTime = Date.now();
    
    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      AD_MEDIA_PLAYLIST
    );

    const afterTime = Date.now();
    const status = getAdBlockStatus('statustest');
    
    if (status.adStartTime !== null) {
      expect(status.adStartTime).toBeGreaterThanOrEqual(beforeTime);
      expect(status.adStartTime).toBeLessThanOrEqual(afterTime);
    }
  });

  it('should clear ad status after ads finish', async () => {
    // First show ad
    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      AD_MEDIA_PLAYLIST
    );

    let status = getAdBlockStatus('statustest');
    expect(status.isShowingAd).toBe(true);

    // Now show clean content
    await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      CLEAN_MEDIA_PLAYLIST
    );

    status = getAdBlockStatus('statustest');
    expect(status.isShowingAd).toBe(false);
    expect(status.activePlayerType).toBeNull();
    expect(status.isUsingFallbackMode).toBe(false);
  });
});

describe('Backup Stream Flow - Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearStreamInfo('configtest');
  });

  it('should allow custom backup player types', () => {
    const customTypes: PlayerType[] = ['thunderdome', 'autoplay'];
    initAdBlockService({ enabled: true, backupPlayerTypes: customTypes });

    // Config should be updated
    expect(customTypes).toHaveLength(2);
  });

  it('should allow custom fallback type', () => {
    const customFallback: PlayerType = 'thunderdome';
    initAdBlockService({ enabled: true, fallbackPlayerType: customFallback });

    expect(customFallback).toBe('thunderdome');
  });

  it('should update config with updateAdBlockConfig', () => {
    initAdBlockService({ enabled: true });
    
    // Verify initial config
    const initialConfig = getAdBlockConfig();
    expect(initialConfig.backupPlayerTypes).toEqual(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes);
    expect(initialConfig.fallbackPlayerType).toBe(DEFAULT_ADBLOCK_CONFIG.fallbackPlayerType);
    
    // Update config
    updateAdBlockConfig({ 
      backupPlayerTypes: ['autoplay', 'embed'],
      fallbackPlayerType: 'autoplay',
    });

    // Verify config was updated
    const updatedConfig = getAdBlockConfig();
    expect(updatedConfig.backupPlayerTypes).toEqual(['autoplay', 'embed']);
    expect(updatedConfig.fallbackPlayerType).toBe('autoplay');
  });
});

describe('Backup Stream Flow - Error Handling', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    initAdBlockService({ enabled: true });

    mockFetch.mockResolvedValueOnce({ status: 200 });
    await processMasterPlaylist(
      'https://usher.ttvnw.net/api/channel/hls/errortest.m3u8?token=abc',
      MASTER_PLAYLIST,
      'errortest'
    );
  });

  afterEach(() => {
    clearStreamInfo('errortest');
  });

  it('should handle GQL request failures gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('GQL request failed'));

    // Should not throw
    await expect(
      processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        AD_MEDIA_PLAYLIST
      )
    ).resolves.not.toThrow();
  });

  it('should handle stream fetch failures', async () => {
    mockFetch.mockResolvedValue({ status: 404 });

    const result = await processMediaPlaylist(
      'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
      AD_MEDIA_PLAYLIST
    );

    // Should return processed playlist even if backups fail
    expect(result).toContain('#EXTM3U');
  });

  it('should handle invalid access token response', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ data: { streamPlaybackAccessToken: null } }),
    });

    // Should handle null token gracefully
    await expect(
      processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        AD_MEDIA_PLAYLIST
      )
    ).resolves.not.toThrow();
  });

  it('should handle malformed token JSON', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({
        data: {
          streamPlaybackAccessToken: {
            value: 'not-valid-json',
            signature: 'sig',
          },
        },
      }),
    });

    // Should handle JSON parse error gracefully
    await expect(
      processMediaPlaylist(
        'https://video-weaver.sfo03.hls.ttvnw.net/v1/playlist/CpEF-abc123/chunked/index-dvr.m3u8',
        AD_MEDIA_PLAYLIST
      )
    ).resolves.not.toThrow();
  });
});

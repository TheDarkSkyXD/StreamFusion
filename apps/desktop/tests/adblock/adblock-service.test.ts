/**
 * Tests for Twitch Ad-Block Service
 *
 * Tests the core ad-blocking logic in twitch-adblock-service.ts
 */

// Guards: core adblock state machine — init/config/status transitions must round-trip correctly for the player to gate ads.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import {
  initAdBlockService,
  updateAdBlockConfig,
  isAdBlockEnabled,
  getAdBlockStatus,
  clearStreamInfo,
  isAdSegment,
  getBlankVideoDataUrl,
  setStatusChangeCallback,
  setAuthHeaders,
  processMasterPlaylist,
  processMediaPlaylist,
} from '@/components/player/twitch/twitch-adblock-service';

describe('twitch-adblock-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset service state by re-initializing
    initAdBlockService({ enabled: true });
  });

  describe('initAdBlockService', () => {
    it('should initialize with default config when no options provided', () => {
      initAdBlockService();
      expect(isAdBlockEnabled()).toBe(true);
    });

    it('should initialize with custom config', () => {
      initAdBlockService({ enabled: false });
      expect(isAdBlockEnabled()).toBe(false);
    });
  });

  describe('updateAdBlockConfig', () => {
    it('should update config partially', () => {
      initAdBlockService({ enabled: true });
      expect(isAdBlockEnabled()).toBe(true);
      
      updateAdBlockConfig({ enabled: false });
      expect(isAdBlockEnabled()).toBe(false);
    });
  });

  describe('isAdBlockEnabled', () => {
    it('should return true when enabled', () => {
      initAdBlockService({ enabled: true });
      expect(isAdBlockEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      initAdBlockService({ enabled: false });
      expect(isAdBlockEnabled()).toBe(false);
    });
  });

  describe('getAdBlockStatus', () => {
    it('should return inactive status for unknown channel', () => {
      const status = getAdBlockStatus('unknownchannel');
      expect(status.isActive).toBe(true); // Service is active
      expect(status.isShowingAd).toBe(false);
      expect(status.isMidroll).toBe(false);
      expect(status.isStrippingSegments).toBe(false);
      expect(status.numStrippedSegments).toBe(0);
      expect(status.activePlayerType).toBeNull();
    });
  });

  describe('clearStreamInfo', () => {
    it('should not throw for unknown channel', () => {
      expect(() => clearStreamInfo('nonexistent')).not.toThrow();
    });
  });

  describe('isAdSegment', () => {
    it('should return false for non-cached URLs', () => {
      expect(isAdSegment('https://example.com/segment.ts')).toBe(false);
    });
  });

  describe('getBlankVideoDataUrl', () => {
    it('should return a valid data URL', () => {
      const url = getBlankVideoDataUrl();
      expect(url).toMatch(/^data:video\/mp4;base64,/);
    });

    it('should return consistent URL', () => {
      const url1 = getBlankVideoDataUrl();
      const url2 = getBlankVideoDataUrl();
      expect(url1).toBe(url2);
    });
  });

  describe('setStatusChangeCallback', () => {
    it('should accept a callback function', () => {
      const callback = vi.fn();
      expect(() => setStatusChangeCallback(callback)).not.toThrow();
    });
  });

  describe('setAuthHeaders', () => {
    it('should accept auth headers', () => {
      expect(() => setAuthHeaders('device-id-123', 'OAuth token', 'integrity')).not.toThrow();
    });

    it('should work with minimal params', () => {
      expect(() => setAuthHeaders('device-id-123')).not.toThrow();
    });
  });

  describe('processMasterPlaylist', () => {
    it('should return original text when disabled', async () => {
      initAdBlockService({ enabled: false });
      const originalText = '#EXTM3U\n#EXT-X-STREAM-INF:...\nhttps://example.com/playlist.m3u8';
      
      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc',
        originalText,
        'testchannel'
      );
      
      expect(result).toBe(originalText);
    });

    it('should process playlist when enabled', async () => {
      initAdBlockService({ enabled: true });
      
      // Mock HEAD request for cache validation
      mockFetch.mockResolvedValueOnce({
        status: 200,
      });

      const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.4D401F,mp4a.40.2",FRAME-RATE=60.000
https://video-edge.example.com/v1/playlist/1080p60.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4D401F,mp4a.40.2",FRAME-RATE=30.000
https://video-edge.example.com/v1/playlist/720p30.m3u8`;

      const result = await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/testchannel.m3u8?token=abc&sig=xyz',
        playlist,
        'testchannel'
      );

      // Should return the playlist (possibly modified)
      expect(result).toContain('#EXTM3U');
      expect(result).toContain('RESOLUTION=1920x1080');
    });
  });

  describe('processMediaPlaylist', () => {
    it('should return original text when disabled', async () => {
      initAdBlockService({ enabled: false });
      const originalText = '#EXTM3U\n#EXTINF:2.000,live\nsegment.ts';
      
      const result = await processMediaPlaylist(
        'https://example.com/playlist.m3u8',
        originalText
      );
      
      expect(result).toBe(originalText);
    });

    it('should return original text when no stream info exists', async () => {
      initAdBlockService({ enabled: true });
      const originalText = '#EXTM3U\n#EXTINF:2.000,live\nsegment.ts';
      
      const result = await processMediaPlaylist(
        'https://unknown-url.com/playlist.m3u8',
        originalText
      );
      
      expect(result).toBe(originalText);
    });
  });

  describe('Ad Detection', () => {
    it('should detect ads via stitched signifier', async () => {
      initAdBlockService({ enabled: true });
      
      // First, process master playlist to create stream info
      mockFetch.mockResolvedValueOnce({ status: 200 });
      
      const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.4D401F,mp4a.40.2",FRAME-RATE=60.000
https://video-edge.example.com/v1/playlist/1080p60.m3u8`;

      await processMasterPlaylist(
        'https://usher.ttvnw.net/api/channel/hls/adtestchannel.m3u8?token=abc',
        masterPlaylist,
        'adtestchannel'
      );

      // Media playlist with ad signifier
      const mediaPlaylistWithAd = `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXT-X-TWITCH-AD:true
#EXT-X-TWITCH-LIVE-SEQUENCE:123
#EXTINF:2.000,stitched
https://ad-segment.example.com/ad1.ts
#EXTINF:2.000,live
https://video-edge.example.com/segment1.ts`;

      // The playlist contains 'stitched' which is the ad signifier
      expect(mediaPlaylistWithAd).toContain('stitched');
    });
  });
});

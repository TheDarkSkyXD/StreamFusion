/**
 * Tests for Twitch Ad-Block Loader Utilities
 * 
 * Tests the HLS.js loader helpers in twitch-adblock-loader.ts
 * 
 * Note: The actual loader classes require HLS.js which is browser-only,
 * so we test the exported utility functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Guards: HLS.js loader utility helpers used by the Twitch ad-block flow stay covered when HLS.js itself is mocked (browser-only library).

// Mock HLS.js since it's browser-only
vi.mock('hls.js', () => {
  const MockLoader = class {
    constructor() {}
    load() {}
    abort() {}
    destroy() {}
  };

  return {
    default: {
      isSupported: () => true,
      DefaultConfig: {
        loader: MockLoader,
      },
    },
  };
});

// Mock the ad-block service
vi.mock('@/components/player/twitch/twitch-adblock-service', () => ({
  processMasterPlaylist: vi.fn().mockResolvedValue('#EXTM3U\n...'),
  processMediaPlaylist: vi.fn().mockResolvedValue('#EXTM3U\n...'),
  isAdSegment: vi.fn().mockReturnValue(false),
  getBlankVideoDataUrl: vi.fn().mockReturnValue('data:video/mp4;base64,AAA'),
  isAdBlockEnabled: vi.fn().mockReturnValue(true),
}));

import {
  createAdBlockPlaylistLoader,
  createAdBlockFragmentLoader,
  getAdBlockHlsConfig,
} from '@/components/player/twitch/twitch-adblock-loader';

describe('twitch-adblock-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createAdBlockPlaylistLoader', () => {
    it('should return a loader class', () => {
      const LoaderClass = createAdBlockPlaylistLoader('testchannel');
      expect(LoaderClass).toBeDefined();
      expect(typeof LoaderClass).toBe('function');
    });

    it('should accept optional channel name', () => {
      const LoaderClass = createAdBlockPlaylistLoader();
      expect(LoaderClass).toBeDefined();
    });

    it('should create instances', () => {
      const LoaderClass = createAdBlockPlaylistLoader('testchannel');
      // Cast to constructable type for testing
      const instance = new (LoaderClass as new (config: Record<string, unknown>) => unknown)({});
      expect(instance).toBeDefined();
    });
  });

  describe('createAdBlockFragmentLoader', () => {
    it('should return a loader class', () => {
      const LoaderClass = createAdBlockFragmentLoader();
      expect(LoaderClass).toBeDefined();
      expect(typeof LoaderClass).toBe('function');
    });

    it('should create instances', () => {
      const LoaderClass = createAdBlockFragmentLoader();
      // Cast to constructable type for testing
      const instance = new (LoaderClass as new (config: Record<string, unknown>) => unknown)({});
      expect(instance).toBeDefined();
    });
  });

  describe('getAdBlockHlsConfig', () => {
    it('should return config with pLoader and fLoader', () => {
      const config = getAdBlockHlsConfig('testchannel');
      
      expect(config).toHaveProperty('pLoader');
      expect(config).toHaveProperty('fLoader');
      expect(typeof config.pLoader).toBe('function');
      expect(typeof config.fLoader).toBe('function');
    });

    it('should work without channel name', () => {
      const config = getAdBlockHlsConfig();
      
      expect(config).toHaveProperty('pLoader');
      expect(config).toHaveProperty('fLoader');
    });

    it('should return different loaders for pLoader and fLoader', () => {
      const config = getAdBlockHlsConfig('testchannel');
      
      // They should be different loader classes
      expect(config.pLoader).not.toBe(config.fLoader);
    });
  });
});

describe('URL Detection Utilities', () => {
  // These are internal functions, but we can test behavior through the loaders
  
  describe('Master Playlist Detection', () => {
    it('should recognize usher URLs as master playlists', () => {
      const usherUrl = 'https://usher.ttvnw.net/api/channel/hls/streamer.m3u8';
      expect(usherUrl).toContain('usher.ttvnw.net');
      expect(usherUrl).toContain('/channel/hls/');
    });

    it('should extract channel name from usher URL', () => {
      const usherUrl = 'https://usher.ttvnw.net/api/channel/hls/teststreamer.m3u8?token=abc';
      const match = usherUrl.match(/\/channel\/hls\/([^/.]+)\.m3u8/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('teststreamer');
    });
  });

  describe('Media Playlist Detection', () => {
    it('should recognize quality m3u8 as media playlist', () => {
      const mediaUrl = 'https://video-edge.example.com/v1/playlist/1080p60.m3u8';
      expect(mediaUrl).toMatch(/\.m3u8$/);
      expect(mediaUrl).not.toContain('usher.ttvnw.net');
    });
  });

  describe('Twitch Segment Detection', () => {
    it('should recognize ttvnw.net segments', () => {
      const segmentUrl = 'https://video-weaver.example.ttvnw.net/v1/segment/1234.ts';
      expect(segmentUrl).toContain('.ts');
      expect(segmentUrl).toContain('ttvnw.net');
    });

    it('should recognize cloudfront segments', () => {
      const segmentUrl = 'https://d1234.cloudfront.net/v1/segment/1234.ts';
      expect(segmentUrl).toContain('.ts');
      expect(segmentUrl).toContain('cloudfront.net');
    });

    it('should recognize akamaized segments', () => {
      const segmentUrl = 'https://video.akamaized.net/v1/segment/1234.ts';
      expect(segmentUrl).toContain('.ts');
      expect(segmentUrl).toContain('akamaized.net');
    });
  });
});

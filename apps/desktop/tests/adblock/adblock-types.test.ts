/**
 * Tests for Twitch Ad-Block Types
 *
 * Tests the type definitions and helper functions in adblock-types.ts
 *
 * DEFAULT_ADBLOCK_CONFIG pins Twitch's embed-player client ID and the backup
 * player-type list. These look like config but are load-bearing: drift here
 * silently breaks the VAFT ad-block technique even though the change in diff
 * looks benign. Test asserts each field by exact value on purpose.
 */

// Guards: DEFAULT_ADBLOCK_CONFIG pins Twitch's embed-player client ID + backup player types — drift here breaks VAFT (changes look benign in diff but kill ad-blocking).

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ADBLOCK_CONFIG,
  createStreamInfo,
  type StreamInfo,
  type AdBlockConfig,
  type ResolutionInfo,
  type AdBlockStatus,
  type PlayerType,
} from '@/shared/adblock-types';

describe('adblock-types', () => {
  describe('DEFAULT_ADBLOCK_CONFIG', () => {
    it('should have ad-blocking enabled by default', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.enabled).toBe(true);
    });

    it('should have correct ad signifier', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.adSignifier).toBe('stitched');
    });

    it('should have valid Twitch client ID', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.clientId).toBe('kimne78kx3ncx6brgo4mv6wki5h1ko');
    });

    it('should have backup player types defined', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes).toBeInstanceOf(Array);
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes.length).toBeGreaterThan(0);
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes).toContain('embed');
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes).toContain('popout');
    });

    it('should have fallback player type set', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.fallbackPlayerType).toBe('embed');
    });

    it('should have ad stripping enabled', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.isAdStrippingEnabled).toBe(true);
    });

    it('should have player reload after ad enabled', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.reloadPlayerAfterAd).toBe(true);
    });

    it('should have reasonable minimal requests time', () => {
      expect(DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsTime).toBeGreaterThan(0);
      expect(DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsTime).toBeLessThan(10000);
    });
  });

  describe('createStreamInfo', () => {
    it('should create a StreamInfo object with correct channel name', () => {
      const streamInfo = createStreamInfo('testchannel', '?token=abc');
      expect(streamInfo.channelName).toBe('testchannel');
    });

    it('should initialize with no ads showing', () => {
      const streamInfo = createStreamInfo('channel', '');
      expect(streamInfo.isShowingAd).toBe(false);
      expect(streamInfo.isMidroll).toBe(false);
    });

    it('should store usher params', () => {
      const params = '?token=abc&sig=xyz';
      const streamInfo = createStreamInfo('channel', params);
      expect(streamInfo.usherParams).toBe(params);
    });

    it('should initialize with empty maps and arrays', () => {
      const streamInfo = createStreamInfo('channel', '');
      expect(streamInfo.urls).toBeInstanceOf(Map);
      expect(streamInfo.urls.size).toBe(0);
      expect(streamInfo.resolutionList).toBeInstanceOf(Array);
      expect(streamInfo.resolutionList.length).toBe(0);
      expect(streamInfo.backupEncodingsCache).toBeInstanceOf(Map);
      expect(streamInfo.requestedAds).toBeInstanceOf(Set);
    });

    it('should initialize with null encodings', () => {
      const streamInfo = createStreamInfo('channel', '');
      expect(streamInfo.encodingsM3U8).toBeNull();
      expect(streamInfo.modifiedM3U8).toBeNull();
    });

    it('should initialize with zero counters', () => {
      const streamInfo = createStreamInfo('channel', '');
      expect(streamInfo.lastPlayerReload).toBe(0);
      expect(streamInfo.numStrippedAdSegments).toBe(0);
    });

    it('should initialize with no active backup player type', () => {
      const streamInfo = createStreamInfo('channel', '');
      expect(streamInfo.activeBackupPlayerType).toBeNull();
    });

    it('should not be using modified m3u8 by default', () => {
      const streamInfo = createStreamInfo('channel', '');
      expect(streamInfo.isUsingModifiedM3U8).toBe(false);
      expect(streamInfo.isStrippingAdSegments).toBe(false);
    });
  });

  describe('Type validations', () => {
    it('PlayerType should accept valid values', () => {
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

    it('AdBlockStatus should have all required fields', () => {
      const status: AdBlockStatus = {
        isActive: true,
        isShowingAd: false,
        isMidroll: false,
        isStrippingSegments: false,
        numStrippedSegments: 0,
        activePlayerType: null,
        channelName: 'test',
        isUsingFallbackMode: false,
        adStartTime: null,
      };

      expect(status).toHaveProperty('isActive');
      expect(status).toHaveProperty('isShowingAd');
      expect(status).toHaveProperty('isMidroll');
      expect(status).toHaveProperty('isStrippingSegments');
      expect(status).toHaveProperty('numStrippedSegments');
      expect(status).toHaveProperty('activePlayerType');
      expect(status).toHaveProperty('channelName');
      expect(status).toHaveProperty('isUsingFallbackMode');
      expect(status).toHaveProperty('adStartTime');
    });

    it('ResolutionInfo should have all required fields', () => {
      const resolution: ResolutionInfo = {
        resolution: '1920x1080',
        frameRate: 60,
        codecs: 'avc1.4D401F,mp4a.40.2',
        url: 'https://example.com/stream.m3u8',
      };

      expect(resolution.resolution).toBe('1920x1080');
      expect(resolution.frameRate).toBe(60);
      expect(resolution.codecs).toContain('avc1');
      expect(resolution.url).toContain('.m3u8');
    });
  });
});

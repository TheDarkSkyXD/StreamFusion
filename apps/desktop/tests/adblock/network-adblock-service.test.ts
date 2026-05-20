/**
 * Tests for Network Ad Block Service
 *
 * Tests the network-level ad blocking in network-adblock-service.ts
 */

// Guards: network-level URL blocking — specific Twitch ad-server domains (edge.ads.twitch.tv etc.) must stay blocked; new ad endpoints get added here when discovered.

import { describe, it, expect, beforeEach } from 'vitest';
import { networkAdBlockService } from '@/backend/services/network-adblock-service';

describe('network-adblock-service', () => {
  beforeEach(() => {
    // Ensure service is enabled before each test
    networkAdBlockService.enable();
  });

  describe('shouldBlock', () => {
    describe('Twitch Ad Servers', () => {
      it('should block edge.ads.twitch.tv', () => {
        const result = networkAdBlockService.shouldBlock('https://edge.ads.twitch.tv/v1/segment');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('ads');
        expect(result.rule?.description).toBe('Twitch ad server');
      });

      it('should block with http protocol', () => {
        const result = networkAdBlockService.shouldBlock('http://edge.ads.twitch.tv/v1/segment');
        expect(result.blocked).toBe(true);
      });
    });

    describe('Twitch Telemetry', () => {
      it('should block spade.twitch.tv', () => {
        const result = networkAdBlockService.shouldBlock('https://spade.twitch.tv/track');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('telemetry');
      });

      it('should block countess.twitch.tv', () => {
        const result = networkAdBlockService.shouldBlock('https://countess.twitch.tv/report');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('telemetry');
      });

      it('should block science.twitch.tv', () => {
        const result = networkAdBlockService.shouldBlock('https://science.twitch.tv/v1/events');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('telemetry');
      });
    });

    describe('Third-party Ad SDKs', () => {
      it('should block Google IMA SDK', () => {
        const result = networkAdBlockService.shouldBlock('https://imasdk.googleapis.com/js/sdkloader/ima3.js');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('ads');
        expect(result.rule?.description).toBe('Google IMA SDK');
      });

      it('should block DoubleClick', () => {
        const result = networkAdBlockService.shouldBlock('https://pubads.g.doubleclick.net/gampad/ads');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('ads');
      });

      it('should block Google Syndication', () => {
        const result = networkAdBlockService.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('ads');
      });

      it('should block Amazon Ads', () => {
        const result = networkAdBlockService.shouldBlock('https://s.amazon-adsystem.com/aax2/apstag.js');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('ads');
      });
    });

    describe('Event Tracking', () => {
      it('should block client-event-reporter.twitch.tv', () => {
        const result = networkAdBlockService.shouldBlock('https://client-event-reporter.twitch.tv/report');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('tracking');
      });

      it('should block trowel.twitch.tv', () => {
        const result = networkAdBlockService.shouldBlock('https://trowel.twitch.tv/api');
        expect(result.blocked).toBe(true);
        expect(result.rule?.category).toBe('tracking');
      });
    });

    describe('Allowed URLs', () => {
      it('should allow normal Twitch API calls', () => {
        const result = networkAdBlockService.shouldBlock('https://api.twitch.tv/helix/streams');
        expect(result.blocked).toBe(false);
        expect(result.rule).toBeUndefined();
      });

      it('should allow Twitch GQL', () => {
        const result = networkAdBlockService.shouldBlock('https://gql.twitch.tv/gql');
        expect(result.blocked).toBe(false);
      });

      it('should allow Twitch video segments', () => {
        const result = networkAdBlockService.shouldBlock('https://video-edge-abc.twitch.tv/v1/segment/123.ts');
        expect(result.blocked).toBe(false);
      });

      it('should allow usher.ttvnw.net', () => {
        const result = networkAdBlockService.shouldBlock('https://usher.ttvnw.net/api/channel/hls/streamer.m3u8');
        expect(result.blocked).toBe(false);
      });

      it('should allow random URLs', () => {
        const result = networkAdBlockService.shouldBlock('https://example.com/page');
        expect(result.blocked).toBe(false);
      });
    });
  });

  describe('enable/disable', () => {
    it('should not block when disabled', () => {
      networkAdBlockService.disable();
      
      const result = networkAdBlockService.shouldBlock('https://edge.ads.twitch.tv/v1/segment');
      expect(result.blocked).toBe(false);
    });

    it('should block when re-enabled', () => {
      networkAdBlockService.disable();
      networkAdBlockService.enable();
      
      const result = networkAdBlockService.shouldBlock('https://edge.ads.twitch.tv/v1/segment');
      expect(result.blocked).toBe(true);
    });
  });

  describe('toggle', () => {
    it('should toggle from enabled to disabled', () => {
      networkAdBlockService.enable();
      const result = networkAdBlockService.toggle();
      
      expect(result).toBe(false);
      expect(networkAdBlockService.isActive()).toBe(false);
    });

    it('should toggle from disabled to enabled', () => {
      networkAdBlockService.disable();
      const result = networkAdBlockService.toggle();
      
      expect(result).toBe(true);
      expect(networkAdBlockService.isActive()).toBe(true);
    });
  });

  describe('isActive', () => {
    it('should return true when enabled', () => {
      networkAdBlockService.enable();
      expect(networkAdBlockService.isActive()).toBe(true);
    });

    it('should return false when disabled', () => {
      networkAdBlockService.disable();
      expect(networkAdBlockService.isActive()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return stats object', () => {
      const stats = networkAdBlockService.getStats();
      
      expect(stats).toHaveProperty('totalBlocked');
      expect(stats).toHaveProperty('byCategory');
      expect(stats).toHaveProperty('recentBlocked');
      expect(typeof stats.totalBlocked).toBe('number');
      expect(Array.isArray(stats.recentBlocked)).toBe(true);
    });

    it('should increment stats when blocking', () => {
      const statsBefore = networkAdBlockService.getStats();
      const beforeTotal = statsBefore.totalBlocked;
      
      networkAdBlockService.shouldBlock('https://edge.ads.twitch.tv/ad1');
      networkAdBlockService.shouldBlock('https://spade.twitch.tv/track1');
      
      const statsAfter = networkAdBlockService.getStats();
      expect(statsAfter.totalBlocked).toBe(beforeTotal + 2);
    });

    it('should track by category', () => {
      networkAdBlockService.shouldBlock('https://edge.ads.twitch.tv/ad1');
      networkAdBlockService.shouldBlock('https://spade.twitch.tv/track1');
      
      const stats = networkAdBlockService.getStats();
      expect(stats.byCategory['ads']).toBeGreaterThan(0);
      expect(stats.byCategory['telemetry']).toBeGreaterThan(0);
    });

    it('should track recent blocked URLs', () => {
      networkAdBlockService.shouldBlock('https://edge.ads.twitch.tv/unique-url-123');
      
      const stats = networkAdBlockService.getStats();
      expect(stats.recentBlocked).toContain('https://edge.ads.twitch.tv/unique-url-123');
    });

    it('should return a copy (not reference)', () => {
      const stats1 = networkAdBlockService.getStats();
      const stats2 = networkAdBlockService.getStats();
      
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('Case Insensitivity', () => {
    it('should block URLs regardless of case', () => {
      const result1 = networkAdBlockService.shouldBlock('https://EDGE.ADS.TWITCH.TV/v1/segment');
      const result2 = networkAdBlockService.shouldBlock('https://Edge.Ads.Twitch.Tv/v1/segment');
      
      expect(result1.blocked).toBe(true);
      expect(result2.blocked).toBe(true);
    });
  });
});

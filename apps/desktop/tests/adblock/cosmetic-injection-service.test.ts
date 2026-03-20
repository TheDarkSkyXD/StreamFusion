/**
 * Tests for Cosmetic Injection Service
 * 
 * Tests the CSS/scriptlet injection functionality.
 * Note: This is a unit test without Electron - mocks ipcMain and BrowserWindow.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Electron modules
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

// Import after mocking
import { cosmeticInjectionService } from '@/backend/services/cosmetic-injection-service';
import { ipcMain } from 'electron';

describe('cosmetic-injection-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure service is enabled
    cosmeticInjectionService.enable();
  });

  describe('initialize', () => {
    it('should log initialization (IPC handler now in adblock-handlers.ts)', () => {
      // The IPC handler registration was moved to adblock-handlers.ts
      // per CodeRabbit review - this test now just verifies initialize doesn't throw
      expect(() => cosmeticInjectionService.initialize()).not.toThrow();
    });

    it('should not throw when called multiple times', () => {
      expect(() => {
        cosmeticInjectionService.initialize();
        cosmeticInjectionService.initialize();
      }).not.toThrow();
    });
  });

  describe('enable/disable', () => {
    it('should enable the service', () => {
      cosmeticInjectionService.disable();
      cosmeticInjectionService.enable();
      
      expect(cosmeticInjectionService.isActive()).toBe(true);
    });

    it('should disable the service', () => {
      cosmeticInjectionService.enable();
      cosmeticInjectionService.disable();
      
      expect(cosmeticInjectionService.isActive()).toBe(false);
    });
  });

  describe('isActive', () => {
    it('should return true when enabled', () => {
      cosmeticInjectionService.enable();
      expect(cosmeticInjectionService.isActive()).toBe(true);
    });

    it('should return false when disabled', () => {
      cosmeticInjectionService.disable();
      expect(cosmeticInjectionService.isActive()).toBe(false);
    });
  });

  describe('injectIntoWindow', () => {
    it('should not throw when service is disabled', async () => {
      cosmeticInjectionService.disable();
      
      const mockWindow = {
        webContents: {
          insertCSS: vi.fn().mockResolvedValue('css-key'),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
        },
      } as any;
      
      await expect(
        cosmeticInjectionService.injectIntoWindow(mockWindow)
      ).resolves.not.toThrow();
      
      // Should not call insertCSS when disabled
      expect(mockWindow.webContents.insertCSS).not.toHaveBeenCalled();
    });

    it('should inject CSS and scripts when enabled', async () => {
      cosmeticInjectionService.enable();
      
      const mockWindow = {
        webContents: {
          insertCSS: vi.fn().mockResolvedValue('css-key'),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
        },
      } as any;
      
      await cosmeticInjectionService.injectIntoWindow(mockWindow);
      
      expect(mockWindow.webContents.insertCSS).toHaveBeenCalledWith(
        expect.stringContaining('display: none'),
        { cssOrigin: 'user' }
      );
      expect(mockWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('StreamFusion AdBlock'),
        true
      );
    });

    it('should only inject once per window', async () => {
      cosmeticInjectionService.enable();
      
      const mockWebContents = {
        insertCSS: vi.fn().mockResolvedValue('css-key'),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
      };
      
      const mockWindow = { webContents: mockWebContents } as any;
      
      // Inject twice
      await cosmeticInjectionService.injectIntoWindow(mockWindow);
      await cosmeticInjectionService.injectIntoWindow(mockWindow);
      
      // Should only be called once due to WeakSet tracking
      expect(mockWebContents.insertCSS).toHaveBeenCalledTimes(1);
      expect(mockWebContents.executeJavaScript).toHaveBeenCalledTimes(1);
    });

    it('should handle injection errors gracefully', async () => {
      cosmeticInjectionService.enable();
      
      const mockWindow = {
        webContents: {
          insertCSS: vi.fn().mockRejectedValue(new Error('Injection failed')),
          executeJavaScript: vi.fn().mockResolvedValue(undefined),
        },
      } as any;
      
      // Should not throw, just log error
      await expect(
        cosmeticInjectionService.injectIntoWindow(mockWindow)
      ).resolves.not.toThrow();
    });
  });

  describe('IPC Handler Behavior', () => {
    it('should return early when service is disabled (via injectIntoWebContents)', async () => {
      // The IPC handler now delegates to injectIntoWebContents
      // Testing behavior directly since handler is in adblock-handlers.ts
      cosmeticInjectionService.disable();
      
      const mockWebContents = {
        insertCSS: vi.fn().mockResolvedValue('key'),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
      } as any;
      
      await cosmeticInjectionService.injectIntoWebContents(mockWebContents);
      
      // When disabled, should not call insertCSS or executeJavaScript
      expect(mockWebContents.insertCSS).not.toHaveBeenCalled();
      expect(mockWebContents.executeJavaScript).not.toHaveBeenCalled();
    });
  });
});

describe('CSS Content', () => {
  it('should include selectors for Twitch ad elements', async () => {
    cosmeticInjectionService.enable();
    
    const mockWindow = {
      webContents: {
        insertCSS: vi.fn().mockResolvedValue('css-key'),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    
    await cosmeticInjectionService.injectIntoWindow(mockWindow);
    
    const cssArg = mockWindow.webContents.insertCSS.mock.calls[0][0];
    
    // Check for key selectors
    expect(cssArg).toContain('ad-banner-default-text');
    expect(cssArg).toContain('sad-overlay');
    expect(cssArg).toContain('player-ad-overlay');
    expect(cssArg).toContain('display: none');
    expect(cssArg).toContain('visibility: hidden');
  });

  it('should ensure video visibility', async () => {
    cosmeticInjectionService.enable();
    
    const mockWindow = {
      webContents: {
        insertCSS: vi.fn().mockResolvedValue('css-key'),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    
    await cosmeticInjectionService.injectIntoWindow(mockWindow);
    
    const cssArg = mockWindow.webContents.insertCSS.mock.calls[0][0];
    
    expect(cssArg).toContain('video');
    expect(cssArg).toContain('visibility: visible');
  });
});

describe('Scriptlet Content', () => {
  it('should include abort-on-property-read pattern', async () => {
    cosmeticInjectionService.enable();
    
    const mockWindow = {
      webContents: {
        insertCSS: vi.fn().mockResolvedValue('css-key'),
        executeJavaScript: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    
    await cosmeticInjectionService.injectIntoWindow(mockWindow);
    
    const scriptArg = mockWindow.webContents.executeJavaScript.mock.calls[0][0];
    
    expect(scriptArg).toContain('abortOnPropertyRead');
    expect(scriptArg).toContain('Object.defineProperty');
    expect(scriptArg).toContain('StreamFusion AdBlock');
  });
});

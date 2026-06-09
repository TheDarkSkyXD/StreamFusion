/**
 * Network Ad Block Service
 *
 * Blocks ad-related network requests at the Electron session level.
 * Inspired by Ghostery's onBeforeRequest pattern.
 */

import { logger } from "@/backend/logging/logger";

interface BlockStats {
  totalBlocked: number;
  byCategory: Record<string, number>;
  recentBlocked: string[];
}

interface BlockRule {
  pattern: RegExp;
  category: string;
  description: string;
}

class NetworkAdBlockService {
  private isEnabled = true;
  private stats: BlockStats = { totalBlocked: 0, byCategory: {}, recentBlocked: [] };

  // Twitch-specific blocking rules
  private readonly rules: BlockRule[] = [
    // Critical: Ad servers
    {
      pattern: /^https?:\/\/edge\.ads\.twitch\.tv/i,
      category: "ads",
      description: "Twitch ad server",
    },

    // High: Telemetry/Analytics
    {
      pattern: /^https?:\/\/spade\.twitch\.tv/i,
      category: "telemetry",
      description: "Twitch analytics",
    },
    {
      pattern: /^https?:\/\/countess\.twitch\.tv/i,
      category: "telemetry",
      description: "Twitch analytics",
    },
    {
      pattern: /^https?:\/\/science\.twitch\.tv/i,
      category: "telemetry",
      description: "Twitch telemetry",
    },

    // High: Third-party ad SDKs
    {
      pattern: /^https?:\/\/imasdk\.googleapis\.com/i,
      category: "ads",
      description: "Google IMA SDK",
    },
    {
      pattern: /^https?:\/\/(?:pubads|securepubads)\.g\.doubleclick\.net/i,
      category: "ads",
      description: "DoubleClick",
    },
    {
      pattern: /^https?:\/\/pagead2\.googlesyndication\.com/i,
      category: "ads",
      description: "Google Ads",
    },
    {
      pattern: /^https?:\/\/.*\.amazon-adsystem\.com/i,
      category: "ads",
      description: "Amazon Ads",
    },
    {
      pattern: /^https?:\/\/(?:www\.)?googletagmanager\.com/i,
      category: "tracking",
      description: "Google Tag Manager",
    },
    {
      pattern: /^https?:\/\/(?:www\.)?google-analytics\.com/i,
      category: "tracking",
      description: "Google Analytics",
    },
    {
      pattern: /^https?:\/\/(?:[^/]+\.)?useinsider\.com/i,
      category: "tracking",
      description: "Insider analytics",
    },

    // Medium: Event tracking
    {
      pattern: /^https?:\/\/client-event-reporter\.twitch\.tv/i,
      category: "tracking",
      description: "Event reporter",
    },
    {
      pattern: /^https?:\/\/trowel\.twitch\.tv/i,
      category: "tracking",
      description: "Trowel tracking",
    },
  ];

  shouldBlock(url: string): { blocked: boolean; rule?: BlockRule } {
    if (!this.isEnabled) return { blocked: false };
    const matchedRule = this.rules.find((rule) => rule.pattern.test(url));
    if (matchedRule) {
      this.recordBlock(url, matchedRule);
      return { blocked: true, rule: matchedRule };
    }
    return { blocked: false };
  }

  private recordBlock(url: string, rule: BlockRule): void {
    this.stats.totalBlocked++;
    this.stats.byCategory[rule.category] = (this.stats.byCategory[rule.category] || 0) + 1;
    this.stats.recentBlocked.unshift(url);
    if (this.stats.recentBlocked.length > 50) {
      this.stats.recentBlocked.pop();
    }
    logger.debug("Service:NetworkAdblock", "Blocked request", {
      description: rule.description,
      category: rule.category,
    });
  }

  enable(): void {
    this.isEnabled = true;
  }
  disable(): void {
    this.isEnabled = false;
  }
  toggle(): boolean {
    this.isEnabled = !this.isEnabled;
    return this.isEnabled;
  }
  getStats(): BlockStats {
    return { ...this.stats };
  }
  isActive(): boolean {
    return this.isEnabled;
  }
}

export const networkAdBlockService = new NetworkAdBlockService();

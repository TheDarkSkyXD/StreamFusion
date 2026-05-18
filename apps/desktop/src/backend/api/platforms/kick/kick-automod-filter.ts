/**
 * U21 — Kick custom AutoMod filter (pure evaluator).
 *
 * No platform calls, no DOM. Given a message + a `KickAutomodConfig`,
 * decide whether to hold the message and which category to attribute it to.
 *
 * Matching rules:
 *  - Word-boundary, case-insensitive per keyword (`\b<kw>\b` flag `i`).
 *  - Allow-listed sender user IDs bypass evaluation entirely.
 *  - Blocklist runs first (so a word that's both blocklisted and severity-
 *    tagged returns `category: "blocklist"`).
 *  - First match wins; the category and the offending keyword are returned.
 */

import type { KickAutomodConfig } from "@/backend/services/database-service";

export type KickAutoModCategory =
  | "identity"
  | "sexual"
  | "aggression"
  | "bullying"
  | "blocklist";

export type KickAutoModVerdict =
  | { held: false }
  | {
      held: true;
      category: KickAutoModCategory;
      matchedKeyword: string;
    };

export interface KickAutoModInputMessage {
  senderUserId: string;
  text: string;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstWordBoundaryMatch(
  text: string,
  keywords: readonly string[],
): string | null {
  for (const raw of keywords) {
    const kw = raw.trim();
    if (kw.length === 0) continue;
    const pattern = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
    if (pattern.test(text)) return kw;
  }
  return null;
}

const SEVERITY_TIERS: Array<{
  category: Exclude<KickAutoModCategory, "blocklist">;
  pick: (cfg: KickAutomodConfig) => readonly string[];
}> = [
  { category: "identity", pick: (cfg) => cfg.severityIdentity },
  { category: "sexual", pick: (cfg) => cfg.severitySexual },
  { category: "aggression", pick: (cfg) => cfg.severityAggression },
  { category: "bullying", pick: (cfg) => cfg.severityBullying },
];

export function evaluate(
  message: KickAutoModInputMessage,
  config: KickAutomodConfig | null,
): KickAutoModVerdict {
  if (!config) return { held: false };

  // Allow-list short-circuit.
  if (config.allowlistUserIds.includes(message.senderUserId)) {
    return { held: false };
  }

  // Blocklist first.
  const blocklistHit = firstWordBoundaryMatch(
    message.text,
    config.keywordBlocklist,
  );
  if (blocklistHit) {
    return { held: true, category: "blocklist", matchedKeyword: blocklistHit };
  }

  for (const tier of SEVERITY_TIERS) {
    const hit = firstWordBoundaryMatch(message.text, tier.pick(config));
    if (hit) {
      return { held: true, category: tier.category, matchedKeyword: hit };
    }
  }

  return { held: false };
}

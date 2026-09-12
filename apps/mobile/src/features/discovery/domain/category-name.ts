import type { Platform } from "@streamfusion/core/platform";

const CATEGORY_EQUIVALENCES = [
  { key: "slots", twitch: "Slots & Casino", kick: "Slots" },
  {
    key: "grand-theft-auto-v",
    twitch: "Grand Theft Auto V",
    kick: "Grand Theft Auto V (GTA)",
  },
  { key: "counter-strike", twitch: "Counter-Strike", kick: "Counter-Strike 2" },
  { key: "black-desert", twitch: "Black Desert", kick: "Black Desert Online" },
  { key: "free-fire", twitch: "Free Fire", kick: "Garena Free Fire" },
] as const;

const NAME_TO_KEY = new Map<string, string>();
for (const entry of CATEGORY_EQUIVALENCES) {
  NAME_TO_KEY.set(entry.twitch.toLowerCase(), entry.key);
  NAME_TO_KEY.set(entry.kick.toLowerCase(), entry.key);
}

export function normalizeCategoryName(name: string): string {
  const lower = name.toLowerCase().trim();
  return NAME_TO_KEY.get(lower) ?? lower;
}

export function preferredMergePlatform(key: string): Platform {
  return key === "slots" ? "kick" : "twitch";
}

export function namesMatch(left: string, right: string): boolean {
  return normalizeCategoryName(left) === normalizeCategoryName(right);
}

/**
 * Maps the user's `playbackAdvanced` preferences (auth-types
 * `PlaybackAdvancedPreferences`) to the subset of `AdBlockConfig` fields the
 * ad-block (VAFT) token pipeline actually consumes. Mirrors the
 * `hls-buffer-config.ts` resolver pattern: a pure prefs → config mapping with a
 * colocated test, applied at the player's `updateAdBlockConfig` call site.
 *
 * AD-BLOCK PATH ONLY (plan U13, R22/R23). The ad-block service requests tokens
 * with the web Client-Id (`kimne…`) + integrity headers; the non-ad-block
 * resolver (`twitch-gql-client.ts`) uses the Android Client-Id (`kd1unb…`) with
 * a hardcoded `playerType:"site"`. The two pairings are not interchangeable, so
 * these overrides are NEVER pushed into the resolver — only through
 * `updateAdBlockConfig`. When ad-block is off the resolver keeps its working
 * defaults and these prefs have no effect.
 *
 * Only fields that map to a REAL, behavior-active `AdBlockConfig` field are
 * produced here:
 * - `allowHevc`  → `skipPlayerReloadOnHevc` (read in the service's HEVC swap /
 *   reload logic).
 * - `playerType` → `fallbackPlayerType` + prepended onto `backupPlayerTypes`
 *   (the player-type list the service iterates for backup streams). Note:
 *   `AdBlockConfig.forceAccessTokenPlayerType` exists but is never read by the
 *   service, so mapping there would be a dead control — we drive the live
 *   mechanism instead.
 *
 * Defaults (`playerType:"default"`, `allowHevc:false`) produce NO override
 * (`{}`), so an untouched install is behavior-neutral.
 */

import type { AdBlockConfig, PlayerType } from "@/shared/adblock-types";
import {
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  type PlaybackAdvancedPreferences,
} from "@/shared/auth-types";

/** The concrete ad-block `PlayerType` values selectable as an override. */
const VALID_PLAYER_TYPES: readonly PlayerType[] = [
  "site",
  "embed",
  "popout",
  "autoplay",
  "picture-by-picture",
  "thunderdome",
];

function isOverridePlayerType(value: string | undefined): value is PlayerType {
  return value !== undefined && (VALID_PLAYER_TYPES as readonly string[]).includes(value);
}

/**
 * Resolve the persisted (possibly partial / legacy) advanced prefs into the
 * `AdBlockConfig` overrides to pass to `updateAdBlockConfig`.
 *
 * `currentBackupPlayerTypes` is the service's current list (so a chosen type is
 * prepended without dropping the others). When omitted, only the chosen type is
 * used as the backup list.
 *
 * Returns `{}` when the prefs match the behavior-neutral defaults, so callers
 * can apply unconditionally without changing shipped behavior.
 */
export function resolvePlaybackAdvancedAdBlockOverrides(
  prefs?: Partial<PlaybackAdvancedPreferences>,
  currentBackupPlayerTypes?: PlayerType[]
): Partial<AdBlockConfig> {
  const overrides: Partial<AdBlockConfig> = {};

  // allowHevc → skipPlayerReloadOnHevc. Only emit when explicitly true; the
  // default (false) equals DEFAULT_ADBLOCK_CONFIG so it's a no-op either way,
  // but emitting nothing keeps the "defaults produce {}" contract clean.
  const allowHevc =
    typeof prefs?.allowHevc === "boolean"
      ? prefs.allowHevc
      : DEFAULT_PLAYBACK_ADVANCED_PREFERENCES.allowHevc;
  if (allowHevc) {
    overrides.skipPlayerReloadOnHevc = true;
  }

  // playerType → fallbackPlayerType + prepended backupPlayerTypes. "default"
  // (or any unrecognized value) leaves the service's own list untouched.
  if (isOverridePlayerType(prefs?.playerType)) {
    const chosen = prefs.playerType;
    overrides.fallbackPlayerType = chosen;
    const rest = (currentBackupPlayerTypes ?? []).filter((t) => t !== chosen);
    overrides.backupPlayerTypes = [chosen, ...rest];
  }

  return overrides;
}

/**
 * U21 — Renderer-side reader/writer for `kick_automod_config` rows.
 *
 * `dbService` lives in the main process; like other renderer-side DB
 * consumers in this codebase (see `useModLog`), we currently call it
 * directly. A proper IPC bridge is a cross-cutting follow-up.
 */

import { useCallback, useEffect, useState } from "react";

import type { KickAutoModCategory } from "@/backend/api/platforms/kick/kick-automod-filter";
import {
  dbService,
  type KickAutomodConfig,
} from "@/backend/services/database-service";

const EMPTY_CONFIG = (channelId: string): KickAutomodConfig => ({
  channelId,
  keywordBlocklist: [],
  severityIdentity: [],
  severitySexual: [],
  severityAggression: [],
  severityBullying: [],
  allowlistUserIds: [],
  updatedAt: 0,
});

export interface UseKickAutoModConfigResult {
  config: KickAutomodConfig | null;
  reload: () => void;
  setBlocklist: (list: string[]) => void;
  setSeverity: (tier: KickAutoModCategory, list: string[]) => void;
  addAllowlistUser: (userId: string) => void;
}

export function useKickAutoModConfig(
  channelId: string | null,
): UseKickAutoModConfigResult {
  const [config, setConfig] = useState<KickAutomodConfig | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (!channelId) {
      setConfig(null);
      return;
    }
    try {
      const row = dbService.getKickAutomodConfig(channelId);
      setConfig(row);
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: surfacing query failure
      console.warn("[useKickAutoModConfig] getKickAutomodConfig failed", err);
      setConfig(null);
    }
  }, [channelId, reloadCounter]);

  const reload = useCallback(() => {
    setReloadCounter((n) => n + 1);
  }, []);

  const writeConfig = useCallback(
    (updater: (current: KickAutomodConfig) => KickAutomodConfig) => {
      if (!channelId) return;
      const base = config ?? EMPTY_CONFIG(channelId);
      const next = updater(base);
      try {
        dbService.upsertKickAutomodConfig({
          ...next,
          updatedAt: Date.now(),
        });
        setConfig({ ...next, updatedAt: Date.now() });
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: surfacing write failure
        console.warn("[useKickAutoModConfig] upsert failed", err);
      }
    },
    [channelId, config],
  );

  const setBlocklist = useCallback(
    (list: string[]) => {
      writeConfig((cur) => ({ ...cur, keywordBlocklist: list }));
    },
    [writeConfig],
  );

  const setSeverity = useCallback(
    (tier: KickAutoModCategory, list: string[]) => {
      writeConfig((cur) => {
        switch (tier) {
          case "identity":
            return { ...cur, severityIdentity: list };
          case "sexual":
            return { ...cur, severitySexual: list };
          case "aggression":
            return { ...cur, severityAggression: list };
          case "bullying":
            return { ...cur, severityBullying: list };
          case "blocklist":
            return { ...cur, keywordBlocklist: list };
          default:
            return cur;
        }
      });
    },
    [writeConfig],
  );

  const addAllowlistUser = useCallback(
    (userId: string) => {
      writeConfig((cur) => {
        if (cur.allowlistUserIds.includes(userId)) return cur;
        return { ...cur, allowlistUserIds: [...cur.allowlistUserIds, userId] };
      });
    },
    [writeConfig],
  );

  return { config, reload, setBlocklist, setSeverity, addAllowlistUser };
}

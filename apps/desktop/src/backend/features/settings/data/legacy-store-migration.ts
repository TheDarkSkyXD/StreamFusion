import { AUTHENTICATION_STORE_KEYS } from "../../authentication/data/authentication-store-schema";
import Store from "electron-store";

import { dbService } from "@backend/services/database-service";

import { importLegacyFollows } from "../../authentication/data/follow-repository";
import { normalizeLegacyLocalFollows } from "../../authentication/data/legacy-follows";
import { defaults, type ElectronStoreSchema } from "./persistent-store-schema";
const ELECTRON_STORE_KEYS: ReadonlySet<string> = new Set([
  ...AUTHENTICATION_STORE_KEYS,
  "preferences",
  "lastActiveTab",
  "windowBounds",
]);
const PROTECTED_GENERIC_KEYS: ReadonlySet<string> = new Set([
  ...ELECTRON_STORE_KEYS,
  "localFollows",
]);
const RENDERER_STORE_PREFIX = "renderer-store:";
const OPERATIONAL_PREFIX = "operational:";
const MAX_RENDERER_STORE_KEY_LENGTH = 512;
const OPERATIONAL_KEYS = {
  kickApiRateLimit: `${OPERATIONAL_PREFIX}kickApiRateLimit`,
  kickFollowedStreamsCache: `${OPERATIONAL_PREFIX}kickFollowedStreamsCache`,
  downloadQueue: `${OPERATIONAL_PREFIX}downloadQueue`,
  lastDownloadDirectory: `${OPERATIONAL_PREFIX}lastDownloadDirectory`,
  streamRecordingJournal: `${OPERATIONAL_PREFIX}streamRecordingJournal`,
};

export function rendererStoreKey(key: string): string {
  return `${RENDERER_STORE_PREFIX}${key}`;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function assertRendererStoreKey(key: string): void {
  if (
    key.trim().length === 0 ||
    key.length > MAX_RENDERER_STORE_KEY_LENGTH ||
    hasControlCharacter(key)
  ) {
    throw new Error("Generic storage key is invalid");
  }
  if (PROTECTED_GENERIC_KEYS.has(key)) {
    throw new Error(`Generic storage cannot access protected key: ${key}`);
  }
}

function operationalMigrationKey(key: string): string | null {
  if (key === "kickApiRateLimit") return OPERATIONAL_KEYS.kickApiRateLimit;
  if (key === "kickFollowedStreamsCache") return OPERATIONAL_KEYS.kickFollowedStreamsCache;
  if (key === "downloadQueue") return OPERATIONAL_KEYS.downloadQueue;
  if (key === "streamRecordingJournal") return OPERATIONAL_KEYS.streamRecordingJournal;
  return null;
}

export function migrateLegacyStore(storeInstance: Store<ElectronStoreSchema>): void {
  const source = storeInstance.store;
  const sourceEntries = Object.entries(source);
  const migrationEntries = sourceEntries.flatMap(([key, value]) => {
    if (ELECTRON_STORE_KEYS.has(key) || key === "localFollows") return [];
    return [{ key: operationalMigrationKey(key) ?? rendererStoreKey(key), value }];
  });
  const protectedKeys = [...PROTECTED_GENERIC_KEYS];
  dbService.migrateKeyValues(
    {
      entries: migrationEntries,
      deleteKeys: protectedKeys.flatMap((key) => [
        key,
        rendererStoreKey(key),
        `${OPERATIONAL_PREFIX}${key}`,
      ]),
    },
    () => {
      const legacyFollows = normalizeLegacyLocalFollows(
        sourceEntries.find(([key]) => key === "localFollows")?.[1]
      );
      if (legacyFollows.length > 0) importLegacyFollows(dbService.getConnection(), legacyFollows);
    }
  );

  if (Object.keys(source).some((key) => !ELECTRON_STORE_KEYS.has(key))) {
    const retained: ElectronStoreSchema = {
      authTokens: source.authTokens ?? defaults.authTokens,
      appTokens: source.appTokens ?? defaults.appTokens,
      twitchUser: source.twitchUser ?? defaults.twitchUser,
      kickUser: source.kickUser ?? defaults.kickUser,
      preferences: source.preferences ?? defaults.preferences,
      lastActiveTab: source.lastActiveTab ?? defaults.lastActiveTab,
      windowBounds: source.windowBounds ?? defaults.windowBounds,
    };
    if (source.twitchFollowWriteToken !== undefined) {
      retained.twitchFollowWriteToken = source.twitchFollowWriteToken;
    }
    if (source.kickWebBearer !== undefined) {
      retained.kickWebBearer = source.kickWebBearer;
    }
    storeInstance.store = retained;
  }
}

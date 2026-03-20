/**
 * One-time localStorage migration from old "streamforge" or "streamstorm" keys to
 * "streamfusion" keys. Preserves existing beta users' settings/data during the rebrand.
 *
 * Runs synchronously before any Zustand stores initialize.
 */

const MIGRATION_FLAG = "streamfusion-localstorage-migrated";

const KEY_RENAMES: [string, string][] = [
  // StreamForge → StreamFusion (previous name)
  ["streamforge-volume", "streamfusion-volume"],
  ["streamforge-playback-positions", "streamfusion-playback-positions"],
  ["streamforge-history-store", "streamfusion-history-store"],
  ["streamforge-app-store", "streamfusion-app-store"],
  ["streamforge-adblock", "streamfusion-adblock"],
  ["streamforge_search_history", "streamfusion_search_history"],
  // StreamStorm → StreamFusion (original name, for users who skipped StreamForge)
  ["streamstorm-volume", "streamfusion-volume"],
  ["streamstorm-playback-positions", "streamfusion-playback-positions"],
  ["streamstorm-history-store", "streamfusion-history-store"],
  ["streamstorm-app-store", "streamfusion-app-store"],
  ["streamstorm-adblock", "streamfusion-adblock"],
  ["streamstorm_search_history", "streamfusion_search_history"],
];

export function migrateLocalStorage(): void {
  if (localStorage.getItem(MIGRATION_FLAG)) return;

  for (const [oldKey, newKey] of KEY_RENAMES) {
    const oldValue = localStorage.getItem(oldKey);
    if (oldValue !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, oldValue);
    }
  }

  localStorage.setItem(MIGRATION_FLAG, "1");
}

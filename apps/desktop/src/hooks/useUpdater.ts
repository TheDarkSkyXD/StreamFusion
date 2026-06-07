/**
 * useUpdater Hook
 *
 * React hook for interacting with the app auto-update system.
 * Provides check, download, install operations and subscribes to status changes.
 */

import { useCallback, useEffect } from "react";
import { logger } from "@/renderer/logging/logger";
import type {
  CheckFrequency,
  UpdateInfo,
  UpdateProgress,
  UpdateStatus,
} from "@/store/update-store";
import { useUpdateStore } from "@/store/update-store";

function serializeError(error: unknown): Record<string, unknown> | string {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : String(error);
}

interface UseUpdaterReturn {
  // State
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  allowPrerelease: boolean;
  autoCheckEnabled: boolean;
  checkFrequency: CheckFrequency;
  isInitialized: boolean;

  // Computed
  isChecking: boolean;
  isDownloading: boolean;
  isUpdateAvailable: boolean;
  isUpdateDownloaded: boolean;
  hasError: boolean;

  // Actions
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  setAllowPrerelease: (allow: boolean) => Promise<void>;
  setAutoCheckEnabled: (enabled: boolean) => Promise<void>;
  setCheckFrequency: (frequency: CheckFrequency) => Promise<void>;
}

export function useUpdater(): UseUpdaterReturn {
  const store = useUpdateStore();

  // Initialize on mount - get current status and subscribe to changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.updater) {
      return;
    }

    // Get initial status
    const initializeStatus = async () => {
      try {
        const status = await window.electronAPI.updater.getStatus();
        store.updateFromBackend(status);
        store.setInitialized(true);
      } catch (error) {
        logger.error("Hook:Updater", "failed to get initial status", {
          error: serializeError(error),
        });
      }
    };

    initializeStatus();

    // Subscribe to status changes
    const unsubscribeStatus = window.electronAPI.updater.onStatusChange((state) => {
      store.updateFromBackend(state);
    });

    // Subscribe to progress updates
    const unsubscribeProgress = window.electronAPI.updater.onProgress((progress) => {
      store.setProgress(progress);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeProgress();
    };
  }, [store]);

  // Check for updates
  const checkForUpdates = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    try {
      const result = await window.electronAPI.updater.check();
      store.updateFromBackend({
        ...result,
        progress: null,
      });
    } catch (error) {
      logger.error("Hook:Updater", "check failed", { error: serializeError(error) });
      store.setError(error instanceof Error ? error.message : "Failed to check for updates");
      store.setStatus("error");
    }
  }, [store]);

  // Download update
  const downloadUpdate = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    try {
      const result = await window.electronAPI.updater.download();
      store.updateFromBackend({
        ...result,
        allowPrerelease: store.allowPrerelease,
      });
    } catch (error) {
      logger.error("Hook:Updater", "download failed", { error: serializeError(error) });
      store.setError(error instanceof Error ? error.message : "Failed to download update");
      store.setStatus("error");
    }
  }, [store.allowPrerelease, store]);

  // Install update (quits and restarts app)
  const installUpdate = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    try {
      await window.electronAPI.updater.install();
    } catch (error) {
      logger.error("Hook:Updater", "install failed", { error: serializeError(error) });
      store.setError(error instanceof Error ? error.message : "Failed to install update");
      store.setStatus("error");
    }
  }, [store]);

  // Set allow pre-release preference
  const setAllowPrerelease = useCallback(
    async (allow: boolean) => {
      if (!window.electronAPI?.updater) return;

      try {
        const result = await window.electronAPI.updater.setAllowPrerelease(allow);
        store.setAllowPrerelease(result.allowPrerelease);
      } catch (error) {
        logger.error("Hook:Updater", "failed to set prerelease preference", {
          error: serializeError(error),
        });
      }
    },
    [store]
  );

  // Toggle automatic interval checking (U15)
  const setAutoCheckEnabled = useCallback(
    async (enabled: boolean) => {
      if (!window.electronAPI?.updater) return;

      try {
        const result = await window.electronAPI.updater.setAutoCheck({ enabled });
        store.setAutoCheckEnabled(result.autoCheckEnabled);
        store.setCheckFrequency(result.checkFrequency);
      } catch (error) {
        logger.error("Hook:Updater", "failed to set auto-check preference", {
          error: serializeError(error),
        });
      }
    },
    [store]
  );

  // Set the auto-check frequency preset (U15)
  const setCheckFrequency = useCallback(
    async (frequency: CheckFrequency) => {
      if (!window.electronAPI?.updater) return;

      try {
        const result = await window.electronAPI.updater.setAutoCheck({ frequency });
        store.setAutoCheckEnabled(result.autoCheckEnabled);
        store.setCheckFrequency(result.checkFrequency);
      } catch (error) {
        logger.error("Hook:Updater", "failed to set check frequency", {
          error: serializeError(error),
        });
      }
    },
    [store]
  );

  return {
    // State
    status: store.status,
    updateInfo: store.updateInfo,
    progress: store.progress,
    error: store.error,
    allowPrerelease: store.allowPrerelease,
    autoCheckEnabled: store.autoCheckEnabled,
    checkFrequency: store.checkFrequency,
    isInitialized: store.isInitialized,

    // Computed
    isChecking: store.status === "checking",
    isDownloading: store.status === "downloading",
    isUpdateAvailable: store.status === "available",
    isUpdateDownloaded: store.status === "downloaded",
    hasError: store.status === "error",

    // Actions
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    setAllowPrerelease,
    setAutoCheckEnabled,
    setCheckFrequency,
  };
}

/**
 * Hook for just the update settings (pre-release toggle)
 */
function useUpdateSettings() {
  const allowPrerelease = useUpdateStore((s) => s.allowPrerelease);
  const setAllowPrerelease = useUpdateStore((s) => s.setAllowPrerelease);

  const togglePrerelease = useCallback(
    async (allow: boolean) => {
      if (!window.electronAPI?.updater) return;

      try {
        const result = await window.electronAPI.updater.setAllowPrerelease(allow);
        setAllowPrerelease(result.allowPrerelease);
      } catch (error) {
        logger.error("Hook:Updater", "failed to set prerelease preference (settings hook)", {
          error: serializeError(error),
        });
      }
    },
    [setAllowPrerelease]
  );

  return {
    allowPrerelease,
    setAllowPrerelease: togglePrerelease,
  };
}

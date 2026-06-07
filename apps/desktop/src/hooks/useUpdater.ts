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
  const status = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.updateInfo);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const allowPrerelease = useUpdateStore((s) => s.allowPrerelease);
  const autoCheckEnabled = useUpdateStore((s) => s.autoCheckEnabled);
  const checkFrequency = useUpdateStore((s) => s.checkFrequency);
  const isInitialized = useUpdateStore((s) => s.isInitialized);

  const updateFromBackend = useUpdateStore((s) => s.updateFromBackend);
  const setInitialized = useUpdateStore((s) => s.setInitialized);
  const setProgress = useUpdateStore((s) => s.setProgress);
  const setError = useUpdateStore((s) => s.setError);
  const setStatus = useUpdateStore((s) => s.setStatus);
  const storeSetAllowPrerelease = useUpdateStore((s) => s.setAllowPrerelease);
  const storeSetAutoCheckEnabled = useUpdateStore((s) => s.setAutoCheckEnabled);
  const storeSetCheckFrequency = useUpdateStore((s) => s.setCheckFrequency);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.updater) {
      return;
    }

    const initializeStatus = async () => {
      try {
        const backendStatus = await window.electronAPI.updater.getStatus();
        updateFromBackend(backendStatus);
        setInitialized(true);
      } catch (err) {
        logger.error("Hook:Updater", "failed to get initial status", {
          error: serializeError(err),
        });
      }
    };

    initializeStatus();

    const unsubscribeStatus = window.electronAPI.updater.onStatusChange((state) => {
      updateFromBackend(state);
    });

    const unsubscribeProgress = window.electronAPI.updater.onProgress((p) => {
      setProgress(p);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeProgress();
    };
  }, [updateFromBackend, setInitialized, setProgress]);

  const checkForUpdates = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    try {
      const result = await window.electronAPI.updater.check();
      updateFromBackend({
        ...result,
        progress: null,
      });
    } catch (err) {
      logger.error("Hook:Updater", "check failed", { error: serializeError(err) });
      setError(err instanceof Error ? err.message : "Failed to check for updates");
      setStatus("error");
    }
  }, [updateFromBackend, setError, setStatus]);

  const downloadUpdate = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    try {
      const result = await window.electronAPI.updater.download();
      updateFromBackend({
        ...result,
        allowPrerelease,
      });
    } catch (err) {
      logger.error("Hook:Updater", "download failed", { error: serializeError(err) });
      setError(err instanceof Error ? err.message : "Failed to download update");
      setStatus("error");
    }
  }, [allowPrerelease, updateFromBackend, setError, setStatus]);

  const installUpdate = useCallback(async () => {
    if (!window.electronAPI?.updater) return;

    try {
      await window.electronAPI.updater.install();
    } catch (err) {
      logger.error("Hook:Updater", "install failed", { error: serializeError(err) });
      setError(err instanceof Error ? err.message : "Failed to install update");
      setStatus("error");
    }
  }, [setError, setStatus]);

  const setAllowPrerelease = useCallback(
    async (allow: boolean) => {
      if (!window.electronAPI?.updater) return;

      try {
        const result = await window.electronAPI.updater.setAllowPrerelease(allow);
        storeSetAllowPrerelease(result.allowPrerelease);
      } catch (err) {
        logger.error("Hook:Updater", "failed to set prerelease preference", {
          error: serializeError(err),
        });
      }
    },
    [storeSetAllowPrerelease]
  );

  const setAutoCheckEnabled = useCallback(
    async (enabled: boolean) => {
      if (!window.electronAPI?.updater) return;

      try {
        const result = await window.electronAPI.updater.setAutoCheck({ enabled });
        storeSetAutoCheckEnabled(result.autoCheckEnabled);
        storeSetCheckFrequency(result.checkFrequency);
      } catch (err) {
        logger.error("Hook:Updater", "failed to set auto-check preference", {
          error: serializeError(err),
        });
      }
    },
    [storeSetAutoCheckEnabled, storeSetCheckFrequency]
  );

  const setCheckFrequency = useCallback(
    async (frequency: CheckFrequency) => {
      if (!window.electronAPI?.updater) return;

      try {
        const result = await window.electronAPI.updater.setAutoCheck({ frequency });
        storeSetAutoCheckEnabled(result.autoCheckEnabled);
        storeSetCheckFrequency(result.checkFrequency);
      } catch (err) {
        logger.error("Hook:Updater", "failed to set check frequency", {
          error: serializeError(err),
        });
      }
    },
    [storeSetAutoCheckEnabled, storeSetCheckFrequency]
  );

  return {
    status,
    updateInfo,
    progress,
    error,
    allowPrerelease,
    autoCheckEnabled,
    checkFrequency,
    isInitialized,

    isChecking: status === "checking",
    isDownloading: status === "downloading",
    isUpdateAvailable: status === "available",
    isUpdateDownloaded: status === "downloaded",
    hasError: status === "error",

    checkForUpdates,
    downloadUpdate,
    installUpdate,
    setAllowPrerelease,
    setAutoCheckEnabled,
    setCheckFrequency,
  };
}

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

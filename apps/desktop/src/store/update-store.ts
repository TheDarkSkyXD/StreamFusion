import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CheckFrequency } from "@/shared/ipc-channels";

export type { CheckFrequency };

/**
 * Update status types
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

// Valid status values for runtime validation
const UPDATE_STATUSES: UpdateStatus[] = [
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "downloaded",
  "error",
];

// Type guard for UpdateStatus validation
const isUpdateStatus = (value: string): value is UpdateStatus =>
  UPDATE_STATUSES.includes(value as UpdateStatus);

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string | null;
  releaseName: string | null;
}

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

/**
 * Update store state for app auto-updates
 */
interface UpdateState {
  // State
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string | null;
  allowPrerelease: boolean;
  autoCheckEnabled: boolean;
  checkFrequency: CheckFrequency;
  isInitialized: boolean;

  // Actions
  setStatus: (status: UpdateStatus) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setProgress: (progress: UpdateProgress | null) => void;
  setError: (error: string | null) => void;
  setAllowPrerelease: (allow: boolean) => void;
  setAutoCheckEnabled: (enabled: boolean) => void;
  setCheckFrequency: (frequency: CheckFrequency) => void;
  setInitialized: (initialized: boolean) => void;

  // Bulk update from backend state
  updateFromBackend: (state: {
    status: string;
    updateInfo: UpdateInfo | null;
    progress: UpdateProgress | null;
    error: string | null;
    allowPrerelease: boolean;
    autoCheckEnabled?: boolean;
    checkFrequency?: CheckFrequency;
  }) => void;

  // Reset state
  reset: () => void;
}

const initialState = {
  status: "idle" as UpdateStatus,
  updateInfo: null,
  progress: null,
  error: null,
  allowPrerelease: false,
  autoCheckEnabled: false,
  checkFrequency: "daily" as CheckFrequency,
  isInitialized: false,
};

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set) => ({
      ...initialState,

      setStatus: (status) => set({ status }),
      setUpdateInfo: (updateInfo) => set({ updateInfo }),
      setProgress: (progress) => set({ progress }),
      setError: (error) => set({ error }),
      setAllowPrerelease: (allowPrerelease) => set({ allowPrerelease }),
      setAutoCheckEnabled: (autoCheckEnabled) => set({ autoCheckEnabled }),
      setCheckFrequency: (checkFrequency) => set({ checkFrequency }),
      setInitialized: (isInitialized) => set({ isInitialized }),

      updateFromBackend: (state) =>
        // Functional update so backend pushes that omit the auto-check fields
        // (e.g. the download path) don't clobber the current values.
        set((prev) => ({
          // Validate status and fall back to 'error' if invalid
          status: isUpdateStatus(state.status) ? state.status : "error",
          updateInfo: state.updateInfo,
          progress: state.progress,
          error: state.error,
          allowPrerelease: state.allowPrerelease,
          autoCheckEnabled: state.autoCheckEnabled ?? prev.autoCheckEnabled,
          checkFrequency: state.checkFrequency ?? prev.checkFrequency,
        })),

      reset: () => set(initialState),
    }),
    {
      name: "update-store",
      // Only persist user preferences - other state is ephemeral. Auto-check
      // settings are also persisted in the main-process update-settings store
      // (the source of truth); these mirror them for fast initial render.
      partialize: (state) => ({
        allowPrerelease: state.allowPrerelease,
        autoCheckEnabled: state.autoCheckEnabled,
        checkFrequency: state.checkFrequency,
      }),
    }
  )
);

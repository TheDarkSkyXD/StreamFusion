import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Application-wide UI state
 */
interface AppState {
  // Sidebar
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  /** User's manual preference for sidebar collapsed state (not affected by theater mode) */
  userPrefersSidebarCollapsed: boolean;
  /** Whether theater mode is currently active (used to auto-collapse sidebar) */
  isTheaterModeActive: boolean;
  toggleSidebar: () => void;
  /** Set sidebar collapsed state. If isUserAction=true, also updates user preference. */
  setSidebarCollapsed: (collapsed: boolean, isUserAction?: boolean) => void;
  /** Set theater mode active state. Auto-collapses sidebar when entering theater mode. */
  setTheaterModeActive: (active: boolean) => void;

  // Multi-stream
  activeStreams: string[];
  addStream: (streamId: string) => void;
  removeStream: (streamId: string) => void;
  clearStreams: () => void;

  // Debug
  showDebugOverlay: boolean;
  setShowDebugOverlay: (show: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Sidebar
      sidebarOpen: true,
      sidebarCollapsed: false,
      userPrefersSidebarCollapsed: false,
      isTheaterModeActive: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarCollapsed: (collapsed, isUserAction = false) =>
        set((state) => ({
          sidebarCollapsed: collapsed,
          // Only update user preference if this is a manual user action
          userPrefersSidebarCollapsed: isUserAction ? collapsed : state.userPrefersSidebarCollapsed,
        })),
      setTheaterModeActive: (active) =>
        set((state) => ({
          isTheaterModeActive: active,
          // Collapse when entering theater mode, restore user preference when exiting
          sidebarCollapsed: active ? true : state.userPrefersSidebarCollapsed,
        })),

      // Multi-stream
      activeStreams: [],
      showDebugOverlay: false,
      setShowDebugOverlay: (show) => set({ showDebugOverlay: show }),
      addStream: (streamId) =>
        set((state) => ({
          activeStreams: state.activeStreams.includes(streamId)
            ? state.activeStreams
            : [...state.activeStreams, streamId].slice(0, 6), // Max 6 streams
        })),
      removeStream: (streamId) =>
        set((state) => ({
          activeStreams: state.activeStreams.filter((id) => id !== streamId),
        })),
      clearStreams: () => set({ activeStreams: [] }),
    }),
    {
      name: "streamfusion-app-store",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        userPrefersSidebarCollapsed: state.userPrefersSidebarCollapsed,
        showDebugOverlay: state.showDebugOverlay,
      }),
    }
  )
);

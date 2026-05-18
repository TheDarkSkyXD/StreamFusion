/**
 * Reconnect-Dialog Store
 *
 * Tiny shared store that opens/closes the "Reconnect for mod features"
 * dialog from anywhere — used by {@link useRequireModScopes} so any mod
 * action surface can pop the dialog with one call.
 *
 * The dialog itself is mounted once at the app root (AuthProvider).
 */

import { create } from "zustand";

interface ReconnectDialogState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useReconnectDialogStore = create<ReconnectDialogState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));

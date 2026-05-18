/**
 * Reconnect-Dialog Store
 *
 * Tiny shared store that opens/closes the "Reconnect for mod features"
 * dialog from anywhere — used by {@link useRequireModScopes} so any mod
 * action surface can pop the dialog with one call.
 *
 * The dialog itself is mounted once at the app root (AuthProvider).
 *
 * U5 — the payload now carries the missing-scope list (so one consent
 * round-trip covers every scope the current action needs) plus an optional
 * one-shot retry callback the dialog fires on successful reconnect.
 */

import { create } from "zustand";

export interface ReconnectDialogPayload {
  /** Every scope the current action needs that the token doesn't have yet. */
  missingScopes: string[];
  /** Fired exactly once after a successful reconnect, then discarded. */
  onReconnected?: () => void;
}

interface ReconnectDialogState {
  isOpen: boolean;
  missingScopes: string[];
  onReconnected: (() => void) | null;
  open: (payload: ReconnectDialogPayload) => void;
  close: () => void;
  /** Called by the dialog when reconnect succeeds; clears payload + fires callback once. */
  fireReconnected: () => void;
}

export const useReconnectDialogStore = create<ReconnectDialogState>()((set, get) => ({
  isOpen: false,
  missingScopes: [],
  onReconnected: null,
  open: (payload) =>
    set({
      isOpen: true,
      missingScopes: payload.missingScopes,
      onReconnected: payload.onReconnected ?? null,
    }),
  close: () => set({ isOpen: false }),
  fireReconnected: () => {
    const cb = get().onReconnected;
    // Null the callback BEFORE invoking so a re-entrant call (or a second
    // fireReconnected after the dialog reopens) can never fire it twice.
    set({ onReconnected: null });
    if (cb) cb();
  },
}));

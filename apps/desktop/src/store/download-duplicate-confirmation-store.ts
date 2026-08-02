import { create } from "zustand";

import type { DownloadJobKind } from "@/shared/download-types";

interface DuplicateDownloadConfirmation {
  kind: DownloadJobKind;
  title: string;
  resolve: (confirmed: boolean) => void;
}

interface DownloadDuplicateConfirmationState {
  pending: DuplicateDownloadConfirmation | null;
  request: (kind: DownloadJobKind, title: string) => Promise<boolean>;
  resolve: (confirmed: boolean) => void;
}

export const useDownloadDuplicateConfirmationStore = create<DownloadDuplicateConfirmationState>()(
  (set, get) => ({
    pending: null,
    request: (kind, title) => {
      if (get().pending) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        set({ pending: { kind, title, resolve } });
      });
    },
    resolve: (confirmed) => {
      const pending = get().pending;
      if (!pending) return;
      set({ pending: null });
      pending.resolve(confirmed);
    },
  })
);

export function requestDuplicateDownloadConfirmation(
  kind: DownloadJobKind,
  title: string
): Promise<boolean> {
  return useDownloadDuplicateConfirmationStore.getState().request(kind, title);
}

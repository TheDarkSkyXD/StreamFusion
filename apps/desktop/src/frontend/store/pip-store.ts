/**
 * Picture-in-Picture Store
 * Manages the state of mini-player that persists across route navigation
 */
import { create } from "zustand";

import type { Platform } from "@shared/auth-types";

export interface PipStreamInfo {
  platform: Platform;
  channelName: string;
  channelDisplayName: string;
  channelAvatar?: string;
  poster?: string;
  streamUrl: string;
  title?: string;
  categoryName?: string;
  viewerCount?: number;
}

interface PipState {
  // Current stream info for PiP
  currentStream: PipStreamInfo | null;

  // Whether PiP mini-player should be visible
  isPipActive: boolean;

  // Whether the user is on the stream page (not showing mini-player when on stream page)
  isOnStreamPage: boolean;

  // Actions
  setCurrentStream: (stream: PipStreamInfo | null) => void;
  setIsOnStreamPage: (isOnStreamPage: boolean) => void;
  activatePip: () => void;
  deactivatePip: () => void;
  closePip: () => void;
}

export const usePipStore = create<PipState>((set, get) => ({
  currentStream: null,
  isPipActive: false,
  isOnStreamPage: false,

  setCurrentStream: (stream) => {
    const currentStream = get().currentStream;

    // If changing to a different stream, close the PiP
    if (
      stream &&
      currentStream &&
      (stream.platform !== currentStream.platform ||
        stream.channelName !== currentStream.channelName)
    ) {
      set({ currentStream: stream, isPipActive: false, isOnStreamPage: true });
    } else {
      set({ currentStream: stream });
    }
  },

  setIsOnStreamPage: (isOnStreamPage) => {
    const { currentStream } = get();

    // When leaving stream page with an active stream, activate PiP
    if (!isOnStreamPage && currentStream) {
      set({ isOnStreamPage, isPipActive: true });
    } else {
      set({ isOnStreamPage, isPipActive: !isOnStreamPage && !!currentStream });
    }
  },

  activatePip: () => {
    const { currentStream, isOnStreamPage } = get();
    if (currentStream && !isOnStreamPage) {
      set({ isPipActive: true });
    }
  },

  deactivatePip: () => {
    set({ isPipActive: false });
  },

  closePip: () => {
    set({ currentStream: null, isPipActive: false });
  },
}));

import type { ProtectedPlaybackController } from "../../capabilities/protected-playback-controller";

const RUNTIME_DOWNLOAD_URL = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/";

export const desktopProtectedPlaybackController: ProtectedPlaybackController = {
  isAvailable: () =>
    typeof window !== "undefined" && Boolean(window.electronAPI?.protectedPlayback),
  check: (channelSlug) => window.electronAPI!.protectedPlayback.check(channelSlug),
  open: (request) => window.electronAPI!.protectedPlayback.open(request),
  focus: (ownerId) => window.electronAPI!.protectedPlayback.focus({ ownerId }),
  close: (ownerId) => window.electronAPI!.protectedPlayback.close({ ownerId }),
  mute: (ownerId, muted) => window.electronAPI!.protectedPlayback.mute({ ownerId, muted }),
  present: (request) => window.electronAPI!.protectedPlayback.present(request),
  onState: (callback) => window.electronAPI?.protectedPlayback.onState(callback) ?? (() => {}),
  installRuntime: () => window.electronAPI!.openExternal(RUNTIME_DOWNLOAD_URL),
};

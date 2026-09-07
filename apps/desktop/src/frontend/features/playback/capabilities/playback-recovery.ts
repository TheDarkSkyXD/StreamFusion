export interface PlaybackRecoveryObserver {
  noteFragmentLoaded(): void;
  noteManifestParsed(): void;
  noteNetworkError(): void;
}

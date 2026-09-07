export interface AppLifecycle {
  onBeforeQuit(callback: () => void): () => void;
  closeWindow(): void;
}

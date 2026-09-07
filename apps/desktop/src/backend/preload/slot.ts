// Electron-vite requires this stable preload entrypoint. The feature-owned
// implementation remains in multistream; this module only loads that bridge.
export * from "../features/multistream/adapters/electron/slot-preload";

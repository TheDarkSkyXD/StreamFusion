/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_KICK_CLIENT_ID: string;
  readonly VITE_STREAMFUSION_BROWSER_DEV?: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

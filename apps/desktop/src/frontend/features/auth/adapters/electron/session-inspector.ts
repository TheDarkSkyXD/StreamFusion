import type { SessionInspector } from "../../capabilities/session-inspector";

export const electronSessionInspector = {
  tokenStatus: (platform: "twitch" | "kick") => window.electronAPI.auth.tokenStatus(platform),
} satisfies SessionInspector;

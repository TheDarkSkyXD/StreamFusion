import type { SupportLogEntry, SupportLogPort } from "../capabilities/support-settings";

const SEED: readonly SupportLogEntry[] = [
  {
    level: "info",
    message: "Product Store opened. No credentials were written to this log.",
    source: "storage",
  },
  {
    level: "info",
    message: "Playback session used the local ExoPlayer path.",
    source: "player",
  },
  {
    level: "warn",
    message: "GitHub APK download is not registered on this build.",
    source: "network",
  },
  {
    level: "debug",
    message: "Media job journal stayed in app-private storage.",
    source: "jobs",
  },
];

export function createSupportLogPort(
  entries: readonly SupportLogEntry[] = SEED,
): SupportLogPort {
  return {
    list: () => entries,
  };
}

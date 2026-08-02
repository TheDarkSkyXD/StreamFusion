import path from "node:path";

import { app, utilityProcess } from "electron";

import type { CaptionUtilityProcess } from "./local-caption-supervisor";

const UTILITY_ENVIRONMENT_KEYS = new Set([
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LD_LIBRARY_PATH",
  "DYLD_LIBRARY_PATH",
]);

export function captionUtilityEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && UTILITY_ENVIRONMENT_KEYS.has(entry[0].toUpperCase())
    )
  );
}

export function spawnCaptionUtilityProcess(): CaptionUtilityProcess {
  const modulePath = path.join(app.getAppPath(), "out", "utility", "caption-recognizer.cjs");
  return utilityProcess.fork(modulePath, [], {
    serviceName: "StreamFusion Local Captions",
    env: captionUtilityEnvironment(process.env),
  }) as unknown as CaptionUtilityProcess;
}

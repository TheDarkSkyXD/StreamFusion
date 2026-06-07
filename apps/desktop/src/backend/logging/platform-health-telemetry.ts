import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { onPlatformHealthChanged } from "../api/unified/platform-health";
import type { PlatformHealth } from "../api/unified/platform-health";
import type { Platform } from "../../shared/auth-types";
import { logger } from "./logger";

const previousStates = new Map<Platform, PlatformHealth>([
  ["kick", "healthy"],
  ["twitch", "healthy"],
]);

const logPath = path.join(app.getPath("logs"), "platform-health.jsonl");

onPlatformHealthChanged((event) => {
  const fromState = previousStates.get(event.platform) ?? "healthy";
  previousStates.set(event.platform, event.status);

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    platform: event.platform,
    fromState,
    toState: event.status,
    sampleSize: event.sampleSize,
    failureRate: event.failureRate,
    source: "internal",
  });

  try {
    fs.appendFileSync(logPath, line + "\n", "utf8");
  } catch (err) {
    logger.warn("PlatformHealthTelemetry", "Failed to write telemetry line", {
      error: String(err),
    });
  }
});

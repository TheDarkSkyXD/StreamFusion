import os from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { app, powerMonitor } from "electron";

import type { DiagnosticPlatform } from "../../shared/diagnostics-types";
import { logger } from "../logging/logger";
import { type CpuSpeedLimitReading, readWindowsCpuSpeedLimit } from "./cpu-speed-limit-source";
import { diagnosticsObservability } from "./diagnostics-observability";
import { DiagnosticsRuntime, type ElectronProcessMetric } from "./diagnostics-runtime";
import { createProcessIoSampler } from "./process-io-sampler";

function diagnosticPlatform(): DiagnosticPlatform {
  if (
    process.platform === "win32" ||
    process.platform === "darwin" ||
    process.platform === "linux"
  ) {
    return process.platform;
  }
  return "other";
}

const platform = diagnosticPlatform();
let cpuSpeedLimitReading: CpuSpeedLimitReading | null = null;
let nativeCpuSpeedLimitObserved = false;
const processIoSampler = createProcessIoSampler({
  platform,
  onFailure: (message) =>
    logger.warn("Diagnostics", "Process I/O collector unavailable", { message }),
});

export const diagnosticsRuntime = new DiagnosticsRuntime({
  nowMs: Date.now,
  monotonicMs: () => performance.now(),
  createId: randomUUID,
  platform,
  processPid: process.pid,
  cpuCount: Math.max(1, os.cpus().length),
  processCpuUsage: (previous) => process.cpuUsage(previous),
  processMemoryUsage: () => process.memoryUsage(),
  getAppMetrics: () => app.getAppMetrics() as readonly ElectronProcessMetric[],
  isOnBatteryPower: () => powerMonitor.isOnBatteryPower(),
  getSystemIdleTime: () => powerMonitor.getSystemIdleTime(),
  getSystemIdleState: (thresholdSeconds) => powerMonitor.getSystemIdleState(thresholdSeconds),
  getCpuSpeedLimitReading: () => cpuSpeedLimitReading,
  // timer-allowlist: the adaptive diagnostics scheduler owns one cancel-safe one-shot and re-arms after each sample
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer),
  readProcessIo: () => processIoSampler.snapshot(),
  setProcessIoSamplingInterval: (intervalMs) => processIoSampler.setIntervalMs(intervalMs),
  refreshProcessIoProcessSet: () => processIoSampler.refreshProcessSet(),
  writeProcessMonitorLine: (line) => logger.info("ProcessMonitor", line),
  getObservabilitySnapshot: (sinceMs) => diagnosticsObservability.snapshot(sinceMs),
  diagnosticsHistoryPath: () => path.join(app.getPath("userData"), "diagnostics-history.sqlite"),
});

function publishCpuSpeedLimit(percent: number, nativeEvent: boolean): void {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
  if (nativeEvent) nativeCpuSpeedLimitObserved = true;
  cpuSpeedLimitReading = { observedAtMs: Date.now(), percent };
  void diagnosticsRuntime.sampleNow();
}

async function seedWindowsCpuSpeedLimit(): Promise<void> {
  if (platform !== "win32" || nativeCpuSpeedLimitObserved) return;
  const percent = await readWindowsCpuSpeedLimit(powerMonitor.isOnBatteryPower());
  if (percent !== null && !nativeCpuSpeedLimitObserved) publishCpuSpeedLimit(percent, false);
}

void app.whenReady().then(() => {
  if (platform === "win32") {
    void seedWindowsCpuSpeedLimit();
    powerMonitor.on("on-ac", () => void seedWindowsCpuSpeedLimit());
    powerMonitor.on("on-battery", () => void seedWindowsCpuSpeedLimit());
  }
  if (platform === "win32" || platform === "darwin") {
    powerMonitor.on("speed-limit-change", (details) => publishCpuSpeedLimit(details.limit, true));
  }
});

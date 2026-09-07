import type { Platform } from "@streamfusion/core/platform";

export type PlatformHealth = "healthy" | "degraded" | "down";

export interface StatusPageDetail {
  summary: string;
  headline?: string;
  impact?: string;
}

export interface PlatformHealthEvent {
  platform: Platform;
  status: PlatformHealth;
  startedAt: number;
  sampleSize: number;
  failureRate: number;
  source: "internal" | "status-page";
  statusPageDetail?: StatusPageDetail;
}

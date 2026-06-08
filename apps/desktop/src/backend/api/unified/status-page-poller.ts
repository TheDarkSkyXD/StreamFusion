import { createManagedInterval } from "../../../lib/managed-interval";
import type { Platform } from "../../../shared/auth-types";
import { logger } from "../../logging/logger";
import {
  onPlatformHealthChanged,
  recordStatusPageSignal,
  STATUS_PAGE_POLL_INTERVAL_MS,
  type StatusPageSignal,
} from "./platform-health";

const API_COMPONENT_PATTERN = /api|helix|gql|eventsub/i;

const TWITCH_STATUS_URL = "https://status.twitch.com/api/v2/status.json";
const TWITCH_INCIDENTS_URL = "https://status.twitch.com/api/v2/incidents.json";
const KICK_STATUS_URL = "https://status.kick.com/api/v2/status.json";

const RESOLVED_STATUSES = new Set(["resolved", "postmortem"]);

const pollers = new Map<Platform, ReturnType<typeof createManagedInterval>>();

async function pollTwitchStatus(): Promise<StatusPageSignal> {
  let url = TWITCH_STATUS_URL;
  try {
    const statusRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!statusRes.ok) return "no-signal";

    const statusJson = await statusRes.json();
    const indicator: string = statusJson?.status?.indicator ?? "unknown";

    if (indicator === "none") return "all-clear";

    url = TWITCH_INCIDENTS_URL;
    const incidentsRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!incidentsRes.ok) return "no-signal";

    const incidentsJson = await incidentsRes.json();
    const incidents: Array<{ status: string; components: Array<{ name: string }> }> =
      incidentsJson?.incidents ?? [];

    const unresolvedWithApi = incidents.some(
      (inc) =>
        !RESOLVED_STATUSES.has(inc.status) &&
        inc.components?.some((c) => API_COMPONENT_PATTERN.test(c.name))
    );

    return unresolvedWithApi ? "confirmed-outage" : "all-clear";
  } catch (err) {
    logger.warn("StatusPoller", "[poller-r9c2] fetch failed", { url, err: String(err) });
    return "no-signal";
  }
}

async function pollKickStatus(): Promise<StatusPageSignal> {
  const url = KICK_STATUS_URL;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return "no-signal";

    const json = await res.json();
    const indicator: string = json?.status?.indicator ?? "unknown";

    if (indicator === "none") return "all-clear";

    return "confirmed-outage";
  } catch (err) {
    logger.warn("StatusPoller", "[poller-r9c2] fetch failed", { url, err: String(err) });
    return "no-signal";
  }
}

async function pollPlatform(platform: Platform): Promise<void> {
  const signal = platform === "twitch" ? await pollTwitchStatus() : await pollKickStatus();
  recordStatusPageSignal(platform, signal);
}

function startPoller(platform: Platform): void {
  if (pollers.has(platform)) return;
  void pollPlatform(platform);
  const handle = createManagedInterval(
    () => void pollPlatform(platform),
    STATUS_PAGE_POLL_INTERVAL_MS
  );
  pollers.set(platform, handle);
}

function stopPoller(platform: Platform): void {
  const handle = pollers.get(platform);
  if (handle != null) {
    handle.stop();
    pollers.delete(platform);
  }
}

export function initStatusPagePoller(): void {
  onPlatformHealthChanged((event) => {
    if (event.status === "degraded") {
      startPoller(event.platform);
    } else {
      stopPoller(event.platform);
    }
  });
}

export function __resetStatusPagePollerForTests(): void {
  for (const [, handle] of pollers) handle.stop();
  pollers.clear();
}

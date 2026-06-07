import type { Platform } from "../../../shared/auth-types";
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

const pollers = new Map<Platform, ReturnType<typeof setInterval>>();

async function pollTwitchStatus(): Promise<StatusPageSignal> {
  try {
    const statusRes = await fetch(TWITCH_STATUS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!statusRes.ok) return "no-signal";

    const statusJson = await statusRes.json();
    const indicator: string = statusJson?.status?.indicator ?? "unknown";

    if (indicator === "none") return "all-clear";

    const incidentsRes = await fetch(TWITCH_INCIDENTS_URL, { signal: AbortSignal.timeout(10_000) });
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
  } catch {
    return "no-signal";
  }
}

async function pollKickStatus(): Promise<StatusPageSignal> {
  try {
    const res = await fetch(KICK_STATUS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return "no-signal";

    const json = await res.json();
    const indicator: string = json?.status?.indicator ?? "unknown";

    if (indicator === "none") return "all-clear";

    return "confirmed-outage";
  } catch {
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
  const id = setInterval(() => void pollPlatform(platform), STATUS_PAGE_POLL_INTERVAL_MS);
  pollers.set(platform, id);
}

function stopPoller(platform: Platform): void {
  const id = pollers.get(platform);
  if (id != null) {
    clearInterval(id);
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
  for (const [, id] of pollers) clearInterval(id);
  pollers.clear();
}

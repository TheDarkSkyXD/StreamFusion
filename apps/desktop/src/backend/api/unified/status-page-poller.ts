import { createManagedInterval } from "@shared/utils/managed-interval";
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
const RESOLVED_STATUSES = new Set(["resolved", "postmortem", "completed"]);

let twitchPoller: ReturnType<typeof createManagedInterval> | undefined;

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

async function pollTwitch(): Promise<void> {
  recordStatusPageSignal("twitch", await pollTwitchStatus());
}

function startTwitchPoller(): void {
  if (twitchPoller != null) return;
  void pollTwitch();
  twitchPoller = createManagedInterval(() => void pollTwitch(), STATUS_PAGE_POLL_INTERVAL_MS);
}

function stopTwitchPoller(): void {
  twitchPoller?.stop();
  twitchPoller = undefined;
}

export function initStatusPagePoller(): void {
  onPlatformHealthChanged((event) => {
    if (event.platform !== "twitch") return;

    if (event.status === "degraded") {
      startTwitchPoller();
    } else {
      stopTwitchPoller();
    }
  });
}

export function __resetStatusPagePollerForTests(): void {
  stopTwitchPoller();
}

import { createManagedInterval } from "../../../lib/managed-interval";
import type { Platform } from "../../../shared/auth-types";
import { logger } from "../../logging/logger";
import {
  onPlatformHealthChanged,
  recordStatusPageSignal,
  STATUS_PAGE_POLL_INTERVAL_MS,
  type StatusPageDetail,
  type StatusPageSignal,
} from "./platform-health";

const API_COMPONENT_PATTERN = /api|helix|gql|eventsub/i;

const TWITCH_STATUS_URL = "https://status.twitch.com/api/v2/status.json";
const TWITCH_INCIDENTS_URL = "https://status.twitch.com/api/v2/incidents.json";
const KICK_STATUS_CONFIG_URL = "https://status.kick.com/config.json";
const KICK_STARTUP_STATUS_POLL_DELAY_MS = 8_000;
const KICK_STATUS_SHAPE_BACKOFF_MS = 15 * 60_000;

const RESOLVED_STATUSES = new Set(["resolved", "postmortem", "completed"]);
const DEGRADED_TEXT_PATTERN =
  /\b(partial outage|major outage|minor outage|degraded|degradation|disruption|disrupted|investigating|identified|monitoring)\b/i;
const OPERATIONAL_TEXT_PATTERN = /\b(operational|all good|all clear|resolved|postmortem)\b/i;
const KICK_IMPACT_PATTERNS: Array<[RegExp, string]> = [
  [/\bmajor outage\b/i, "Major outage"],
  [/\bpartial outage\b/i, "Partial outage"],
  [/\bminor outage\b/i, "Minor outage"],
  [/\bdegraded functionality\b/i, "Degraded functionality"],
  [/\bdegraded performance\b/i, "Degraded performance"],
  [/\bdegraded\b/i, "Degraded"],
];
const KICK_COMPONENT_NAME_PATTERN = /^(?:kick\.com|kick)$/i;

const pollers = new Map<Platform, ReturnType<typeof createManagedInterval>>();
const warnedKickStatusShapeUrls = new Set<string>();
let kickStatusShapeBackoffUntil = 0;

interface StatusPagePollResult {
  signal: StatusPageSignal;
  detail?: StatusPageDetail;
}

type FetchLike = (
  input: string,
  init?: RequestInit & { bypassCustomProtocolHandlers?: boolean }
) => Promise<Response>;

type JsonResponseResult = { ok: true; value: unknown } | { ok: false };

function getChromiumFetch(): FetchLike {
  try {
    const { net } = require("electron") as typeof import("electron");
    if (typeof net?.fetch === "function") {
      return net.fetch.bind(net) as FetchLike;
    }
  } catch {
    // Unit tests and non-Electron tooling fall back to Node's fetch.
  }
  return fetch as FetchLike;
}

async function readKickStatusJson(response: Response, url: string): Promise<JsonResponseResult> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const explicitlyHtml = contentType.includes("text/html") || contentType.includes("xhtml");
  let body = "";

  if (!explicitlyHtml) {
    body = await response.text();
    const trimmed = body.trimStart();
    const declaresJson = contentType.includes("application/json") || contentType.includes("+json");
    if (declaresJson || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        warnedKickStatusShapeUrls.delete(url);
        return { ok: true, value: JSON.parse(body) };
      } catch {
        // Treat invalid JSON like any other endpoint-shape mismatch below.
      }
    }
  }

  kickStatusShapeBackoffUntil = Date.now() + KICK_STATUS_SHAPE_BACKOFF_MS;
  if (!warnedKickStatusShapeUrls.has(url)) {
    warnedKickStatusShapeUrls.add(url);
    logger.debug("StatusPoller", "Kick status endpoint returned a non-JSON response; backing off", {
      url,
      contentType,
      backoffMs: KICK_STATUS_SHAPE_BACKOFF_MS,
    });
  }
  return { ok: false };
}

function sanitizeStatusString(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function findKickImpact(strings: string[]): string | undefined {
  for (const [, label] of KICK_IMPACT_PATTERNS) {
    if (strings.some((value) => value.toLowerCase() === label.toLowerCase())) return label;
  }
  for (const [pattern, label] of KICK_IMPACT_PATTERNS) {
    if (strings.some((value) => pattern.test(value))) return label;
  }
  return undefined;
}

interface KickStatusComponent {
  name: string;
  status: string;
}

interface KickStatusIncident {
  currentStatus: string;
  resolved: boolean;
  title?: string;
}

interface KickStatusConfig {
  components: KickStatusComponent[];
  incidents: KickStatusIncident[];
}

function normalizeKickStatusLabel(value: string): string {
  const normalizedValue = value.replace(/[_-]+/g, " ");
  const impact = findKickImpact([normalizedValue]);
  if (impact != null) return impact;
  const sanitized = sanitizeStatusString(normalizedValue).toLowerCase();
  return sanitized.length === 0 ? value : sanitized[0].toUpperCase() + sanitized.slice(1);
}

function parseKickStatusConfig(value: unknown): KickStatusConfig | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.components) || !Array.isArray(record.incidents)) return undefined;

  const components: KickStatusComponent[] = [];
  for (const component of record.components) {
    if (component === null || typeof component !== "object") return undefined;
    const componentRecord = component as Record<string, unknown>;
    if (typeof componentRecord.name !== "string" || typeof componentRecord.status !== "string") {
      return undefined;
    }
    components.push({
      name: sanitizeStatusString(componentRecord.name),
      status: sanitizeStatusString(componentRecord.status),
    });
  }

  const incidents: KickStatusIncident[] = [];
  for (const incident of record.incidents) {
    if (incident === null || typeof incident !== "object") return undefined;
    const incidentRecord = incident as Record<string, unknown>;
    if (typeof incidentRecord.currentStatus !== "string") return undefined;
    incidents.push({
      currentStatus: sanitizeStatusString(incidentRecord.currentStatus),
      resolved: incidentRecord.resolved === true,
      title:
        typeof incidentRecord.title === "string"
          ? sanitizeStatusString(incidentRecord.title)
          : undefined,
    });
  }

  return { components, incidents };
}

function buildKickStatusDetail(config: KickStatusConfig): StatusPageDetail | undefined {
  const activeIncident = config.incidents.find(
    (incident) => !incident.resolved && !RESOLVED_STATUSES.has(incident.currentStatus.toLowerCase())
  );
  const affectedComponent = config.components.find(
    (component) =>
      KICK_COMPONENT_NAME_PATTERN.test(component.name) &&
      !OPERATIONAL_TEXT_PATTERN.test(component.status.replace(/[_-]+/g, " "))
  );

  if (affectedComponent == null && activeIncident == null) return undefined;

  const impact = normalizeKickStatusLabel(
    affectedComponent?.status ?? activeIncident?.currentStatus ?? "degraded"
  );
  const headline = activeIncident?.title;
  return headline == null
    ? { summary: `Kick status: ${impact}.`, impact }
    : { summary: `Kick status: ${impact}.`, impact, headline };
}

function toPollResult(signal: StatusPageSignal, detail?: StatusPageDetail): StatusPagePollResult {
  return detail == null ? { signal } : { signal, detail };
}

async function pollTwitchStatus(): Promise<StatusPagePollResult> {
  let url = TWITCH_STATUS_URL;
  try {
    const statusRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!statusRes.ok) return toPollResult("no-signal");

    const statusJson = await statusRes.json();
    const indicator: string = statusJson?.status?.indicator ?? "unknown";

    if (indicator === "none") return toPollResult("all-clear");

    url = TWITCH_INCIDENTS_URL;
    const incidentsRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!incidentsRes.ok) return toPollResult("no-signal");

    const incidentsJson = await incidentsRes.json();
    const incidents: Array<{ status: string; components: Array<{ name: string }> }> =
      incidentsJson?.incidents ?? [];

    const unresolvedWithApi = incidents.some(
      (inc) =>
        !RESOLVED_STATUSES.has(inc.status) &&
        inc.components?.some((c) => API_COMPONENT_PATTERN.test(c.name))
    );

    return toPollResult(unresolvedWithApi ? "confirmed-outage" : "all-clear");
  } catch (err) {
    logger.warn("StatusPoller", "[poller-r9c2] fetch failed", { url, err: String(err) });
    return toPollResult("no-signal");
  }
}

async function pollKickStatus(): Promise<StatusPagePollResult> {
  if (Date.now() < kickStatusShapeBackoffUntil) return toPollResult("no-signal");

  const url = KICK_STATUS_CONFIG_URL;
  try {
    const chromiumFetch = getChromiumFetch();
    const configResponse = await chromiumFetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://status.kick.com/",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!configResponse.ok) return toPollResult("no-signal");

    const configResult = await readKickStatusJson(configResponse, url);
    if (!configResult.ok) return toPollResult("no-signal");
    const config = parseKickStatusConfig(configResult.value);
    if (config == null) {
      kickStatusShapeBackoffUntil = Date.now() + KICK_STATUS_SHAPE_BACKOFF_MS;
      return toPollResult("no-signal");
    }

    const detail = buildKickStatusDetail(config);
    if (detail != null) return toPollResult("confirmed-outage", detail);

    return toPollResult("all-clear");
  } catch (err) {
    logger.warn("StatusPoller", "[poller-r9c2] fetch failed", { url, err: String(err) });
    return toPollResult("no-signal");
  }
}

async function pollPlatform(platform: Platform): Promise<void> {
  const result = platform === "twitch" ? await pollTwitchStatus() : await pollKickStatus();
  if (result.detail != null) {
    recordStatusPageSignal(platform, result.signal, result.detail);
  } else {
    recordStatusPageSignal(platform, result.signal);
  }
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

function startKickPollerWhenElectronIsReady(): void {
  const startAfterStartupDelay = () => {
    setTimeout(() => startPoller("kick"), KICK_STARTUP_STATUS_POLL_DELAY_MS); // timer-allowlist: one-shot post-app-ready Kick status warmup
  };

  try {
    const { app } = require("electron") as typeof import("electron");
    if (typeof app?.isReady !== "function" || typeof app?.whenReady !== "function") {
      startPoller("kick");
      return;
    }
    if (app.isReady()) {
      startAfterStartupDelay();
      return;
    }
    void app.whenReady().then(startAfterStartupDelay);
    return;
  } catch {
    startPoller("kick");
  }
}

export function initStatusPagePoller(): void {
  startKickPollerWhenElectronIsReady();

  onPlatformHealthChanged((event) => {
    if (event.platform === "kick") return;

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
  warnedKickStatusShapeUrls.clear();
  kickStatusShapeBackoffUntil = 0;
}

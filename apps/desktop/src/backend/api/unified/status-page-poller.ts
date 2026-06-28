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
const KICK_SERVICES_URL = "https://status.kick.com/api/services";
const KICK_POSTS_URL = "https://status.kick.com/api/posts?is_featured=true&limit=500";
const KICK_POST_ENUMS_URL = "https://status.kick.com/api/post_enums";
const KICK_STARTUP_STATUS_POLL_DELAY_MS = 8_000;

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
const KICK_SERVICE_NAME_KEYS = ["display_name", "displayName", "name", "label", "service_name"];
const KICK_SERVICE_STATUS_KEYS = ["status", "impact", "state", "status_text", "statusText"];
const KICK_MAIN_STATUS_SERVICES = new Set([
  "public api",
  "public apis",
  "platform",
  "streaming",
  "authentication",
  "chat",
  "notifications",
  "payments",
  "data services",
]);

const pollers = new Map<Platform, ReturnType<typeof createManagedInterval>>();

interface StatusPagePollResult {
  signal: StatusPageSignal;
  detail?: StatusPageDetail;
}

type FetchLike = (
  input: string,
  init?: RequestInit & { bypassCustomProtocolHandlers?: boolean }
) => Promise<Response>;

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

interface KickServiceStatus {
  name: string;
  status: string;
}

interface KickServiceReference {
  id: string;
  name: string;
}

interface KickPostEnum {
  id: string;
  name: string;
  post_enum_type?: string;
}

interface KickPostImpact {
  service_id?: string;
  severity_id?: string;
}

interface KickPostUpdate {
  status_id?: string;
  severity_id?: string;
  impacts?: KickPostImpact[];
}

interface KickPost {
  post_type?: string;
  latest_update?: KickPostUpdate;
}

function stringValueFromKeys(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return sanitizeStatusString(value);
  }
  return undefined;
}

function collectKickServiceStatuses(
  value: unknown,
  out: KickServiceStatus[] = []
): KickServiceStatus[] {
  if (out.length > 100) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKickServiceStatuses(item, out);
    return out;
  }
  if (value === null || typeof value !== "object") return out;

  const record = value as Record<string, unknown>;
  const name = stringValueFromKeys(record, KICK_SERVICE_NAME_KEYS);
  const status = stringValueFromKeys(record, KICK_SERVICE_STATUS_KEYS);
  if (
    name != null &&
    status != null &&
    (DEGRADED_TEXT_PATTERN.test(status) || OPERATIONAL_TEXT_PATTERN.test(status))
  ) {
    out.push({ name, status });
  }

  for (const item of Object.values(record)) collectKickServiceStatuses(item, out);
  return out;
}

function normalizeKickStatusLabel(value: string): string {
  const impact = findKickImpact([value]);
  if (impact != null) return impact;
  const sanitized = sanitizeStatusString(value).toLowerCase();
  return sanitized.length === 0 ? value : sanitized[0].toUpperCase() + sanitized.slice(1);
}

function normalizeKickServiceName(name: string): string {
  return sanitizeStatusString(name)
    .toLowerCase()
    .replace(/^kick\s*-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isKickMainStatusService(name: string): boolean {
  return KICK_MAIN_STATUS_SERVICES.has(normalizeKickServiceName(name));
}

function buildServiceStatusDetail(servicesJson: unknown): StatusPageDetail | undefined {
  const affected = collectKickServiceStatuses(servicesJson)
    .map((service) => ({
      name: service.name,
      impact: normalizeKickStatusLabel(service.status),
    }))
    .filter((service) => isKickMainStatusService(service.name))
    .filter((service) => !OPERATIONAL_TEXT_PATTERN.test(service.impact));

  if (affected.length === 0) return undefined;

  const [first] = affected;
  const impact = first.impact;
  const summary = `Kick status: ${impact}.`;

  return { summary, impact };
}

function collectKickServices(
  value: unknown,
  out: KickServiceReference[] = []
): KickServiceReference[] {
  if (out.length > 200) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKickServices(item, out);
    return out;
  }
  if (value === null || typeof value !== "object") return out;

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;
  const name = stringValueFromKeys(record, ["display_name", "displayName", "name", "label"]);
  if (id != null && name != null) out.push({ id, name });

  for (const item of Object.values(record)) collectKickServices(item, out);
  return out;
}

function collectKickPostEnums(value: unknown, out: KickPostEnum[] = []): KickPostEnum[] {
  if (out.length > 200) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectKickPostEnums(item, out);
    return out;
  }
  if (value === null || typeof value !== "object") return out;

  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && typeof record.name === "string") {
    out.push({
      id: record.id,
      name: sanitizeStatusString(record.name),
      post_enum_type:
        typeof record.post_enum_type === "string"
          ? sanitizeStatusString(record.post_enum_type)
          : undefined,
    });
  }

  for (const item of Object.values(record)) collectKickPostEnums(item, out);
  return out;
}

function collectKickPosts(value: unknown): KickPost[] {
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const posts = record.posts;
  return Array.isArray(posts) ? (posts as KickPost[]) : [];
}

function buildEnumNameMap(enumsJson: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of collectKickPostEnums(enumsJson)) {
    map.set(item.id, item.name);
  }
  return map;
}

function buildServiceNameMap(servicesJson: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const service of collectKickServices(servicesJson)) {
    map.set(service.id, service.name);
  }
  return map;
}

function getEnumName(enumMap: Map<string, string>, id: string | undefined): string | undefined {
  return id == null ? undefined : enumMap.get(id);
}

function isOpenKickPost(post: KickPost, enumMap: Map<string, string>): boolean {
  const status = getEnumName(enumMap, post.latest_update?.status_id);
  return status == null || !RESOLVED_STATUSES.has(status.toLowerCase());
}

function buildKickPostStatusDetail(
  servicesJson: unknown,
  postsJson: unknown,
  enumsJson: unknown
): StatusPageDetail | undefined {
  const enumMap = buildEnumNameMap(enumsJson);
  const serviceMap = buildServiceNameMap(servicesJson);
  const affected = collectKickPosts(postsJson)
    .filter((post) => isOpenKickPost(post, enumMap))
    .flatMap((post) => post.latest_update?.impacts ?? [])
    .map((impact) => {
      const serviceName = serviceMap.get(impact.service_id ?? "");
      if (serviceName == null || !isKickMainStatusService(serviceName)) return undefined;
      const status = getEnumName(enumMap, impact.severity_id);
      return status == null
        ? undefined
        : {
            name: serviceName,
            impact: normalizeKickStatusLabel(status),
          };
    })
    .filter((service): service is { name: string; impact: string } => service != null)
    .filter((service) => !OPERATIONAL_TEXT_PATTERN.test(service.impact));

  if (affected.length === 0) return undefined;

  const deduped = new Map<string, { name: string; impact: string }>();
  for (const service of affected) deduped.set(`${service.name}:${service.impact}`, service);

  const [first] = [...deduped.values()];
  const impact = first.impact;
  const summary = `Kick status: ${impact}.`;

  return { summary, impact };
}

function buildKickStatusDetail(
  servicesJson: unknown,
  postsJson?: unknown,
  enumsJson?: unknown
): StatusPageDetail | undefined {
  if (postsJson != null && enumsJson != null) {
    const postDetail = buildKickPostStatusDetail(servicesJson, postsJson, enumsJson);
    if (postDetail != null) return postDetail;
  }
  return buildServiceStatusDetail(servicesJson);
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
  let url = KICK_SERVICES_URL;
  try {
    const chromiumFetch = getChromiumFetch();
    const servicesRes = await chromiumFetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://status.kick.com/posts/dashboard",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!servicesRes.ok) return toPollResult("no-signal");

    const servicesJson = await servicesRes.json();

    url = KICK_POSTS_URL;
    const postsRes = await chromiumFetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://status.kick.com/posts/dashboard",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!postsRes.ok) return toPollResult("no-signal");
    const postsJson = await postsRes.json();

    url = KICK_POST_ENUMS_URL;
    const enumsRes = await chromiumFetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Referer: "https://status.kick.com/posts/dashboard",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!enumsRes.ok) return toPollResult("no-signal");
    const enumsJson = await enumsRes.json();

    const detail = buildKickStatusDetail(servicesJson, postsJson, enumsJson);
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
}

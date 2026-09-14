import type {
  ProxyDraft,
  ProxyParseResult,
  ProxyTransport,
} from "../capabilities/connectivity-session";

const HOST_PATTERN = /^[A-Za-z0-9._:-]{1,253}$/;

export function emptyProxyDraft(): ProxyDraft {
  return {
    enabled: false,
    host: "",
    password: "",
    portText: "",
    username: "",
  };
}

export function parseProxyDraft(draft: ProxyDraft): ProxyParseResult {
  if (!draft.enabled) return { kind: "disabled" };
  const host = draft.host.trim();
  if (host.length === 0) {
    return { kind: "invalid", reason: "Enter a proxy host without a scheme." };
  }
  if (host.includes("/") || host.includes("://") || !HOST_PATTERN.test(host)) {
    return { kind: "invalid", reason: "Enter a proxy host without a scheme." };
  }
  const portText = draft.portText.trim();
  if (portText.length === 0) {
    return { kind: "invalid", reason: "Enter a port from 1 to 65535." };
  }
  if (!/^[0-9]{1,5}$/.test(portText)) {
    return { kind: "invalid", reason: "Enter a port from 1 to 65535." };
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { kind: "invalid", reason: "Enter a port from 1 to 65535." };
  }
  return { kind: "ready", host, port };
}

export function transportFromParse(parse: ProxyParseResult): ProxyTransport {
  return parse.kind === "ready"
    ? { kind: "on", host: parse.host, port: parse.port }
    : { kind: "off" };
}

export function parseStoredProxy(value: string | null): {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number | null;
} {
  if (value === null || value === "") {
    return { enabled: false, host: "", port: null };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1
    ) {
      return { enabled: false, host: "", port: null };
    }
    const record = parsed as {
      readonly enabled?: unknown;
      readonly host?: unknown;
      readonly port?: unknown;
    };
    const host = typeof record.host === "string" ? record.host : "";
    const port =
      typeof record.port === "number" && Number.isInteger(record.port)
        ? record.port
        : null;
    return {
      enabled: record.enabled === true,
      host,
      port,
    };
  } catch {
    return { enabled: false, host: "", port: null };
  }
}

export function serializeProxy(input: {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number | null;
}): string {
  return JSON.stringify({
    enabled: input.enabled,
    host: input.host,
    port: input.port,
    version: 1,
  });
}

export function draftFromStored(
  stored: ReturnType<typeof parseStoredProxy>,
  credentials: { readonly username: string; readonly password: string } | null,
): ProxyDraft {
  return {
    enabled: stored.enabled,
    host: stored.host,
    password: credentials?.password ?? "",
    portText: stored.port === null ? "" : String(stored.port),
    username: credentials?.username ?? "",
  };
}

export function networkDetail(
  network: "online" | "offline",
  nativeProxy: "ready" | "unavailable",
  proxy: ProxyTransport,
): string {
  if (network === "offline") {
    return "This device is offline. Discovery uses cache when a prior page exists.";
  }
  if (proxy.kind === "on" && nativeProxy === "unavailable") {
    return "Proxy is saved, but StreamFusion Development is required to apply it to requests.";
  }
  if (proxy.kind === "on") {
    return `Online. Requests use ${proxy.host}:${proxy.port}.`;
  }
  return "Online. Requests do not use a proxy.";
}

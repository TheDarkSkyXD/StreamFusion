import { getConnectivityModule } from "../../../../modules/streamfusion-native-contracts/src/contracts";
import type { ProxyTransport } from "../capabilities/connectivity-session";

export function nativeProxyAvailability(): "ready" | "unavailable" {
  try {
    const module = getConnectivityModule();
    if (!module) return "unavailable";
    return module.getContractVersion() === 1 ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function createProxyFetch(input: {
  readonly readTransport: () => Promise<ProxyTransport>;
  readonly readCredentials: () => Promise<{
    readonly username: string;
    readonly password: string;
  } | null>;
}): typeof globalThis.fetch {
  return async (resource, init) => {
    const transport = await input.readTransport();
    if (transport.kind !== "on") {
      return globalThis.fetch(resource, init);
    }
    if (nativeProxyAvailability() !== "ready") {
      throw new TypeError(
        "Proxy is enabled, but StreamFusion Development is required to apply it.",
      );
    }
    if (init?.signal?.aborted) throw abortError();
    const credentials = await input.readCredentials();
    const module = getConnectivityModule();
    if (!module) {
      throw new TypeError(
        "Proxy is enabled, but StreamFusion Development is required to apply it.",
      );
    }
    const requestId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const abort = () => {
      void module.cancelProxyRequest(requestId);
    };
    init?.signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await module.proxyRequest({
        body: bodyFrom(init?.body),
        headers: headersFrom(init?.headers),
        host: transport.host,
        method: init?.method ?? "GET",
        password: credentials?.password ?? "",
        port: transport.port,
        requestId,
        url: requestUrl(resource),
        username: credentials?.username ?? "",
      });
      if (init?.signal?.aborted) throw abortError();
      if (result.kind === "unsupported") {
        if (result.diagnostic === "The request was cancelled.") {
          throw abortError();
        }
        throw new TypeError(result.diagnostic);
      }
      return new Response(result.body, {
        headers: result.headers,
        status: result.status,
      });
    } catch (error) {
      if (init?.signal?.aborted) throw abortError();
      throw error;
    } finally {
      init?.signal?.removeEventListener("abort", abort);
    }
  };
}

function requestUrl(resource: RequestInfo | URL): string {
  if (typeof resource === "string") return resource;
  if (resource instanceof URL) return resource.href;
  return resource.url;
}

function bodyFrom(body: BodyInit | null | undefined): string | null {
  if (body === undefined || body === null) return null;
  return typeof body === "string" ? body : String(body);
}

function headersFrom(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) return {};
  if (headers instanceof Headers) {
    const next: Record<string, string> = {};
    headers.forEach((value, key) => {
      next[key] = value;
    });
    return next;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

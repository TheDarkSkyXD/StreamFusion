import type {
  ConnectivityView,
  NetworkRead,
  ProxyDraft,
} from "../capabilities/connectivity-session";
import {
  draftFromStored,
  emptyProxyDraft,
  networkDetail,
  parseProxyDraft,
  parseStoredProxy,
  transportFromParse,
} from "./proxy-config";

export function composeConnectivityView(input: {
  readonly credentials: {
    readonly username: string;
    readonly password: string;
  } | null;
  readonly nativeProxy: "ready" | "unavailable";
  readonly network: NetworkRead;
  readonly saveDetail?: string | null;
  readonly stored: string | null;
  readonly draft?: ProxyDraft;
}): ConnectivityView {
  const stored = parseStoredProxy(input.stored);
  const draft =
    input.draft ?? draftFromStored(stored, input.credentials);
  const parse = parseProxyDraft(draft);
  const proxy =
    parse.kind === "ready" || parse.kind === "disabled"
      ? transportFromParse(parse)
      : stored.enabled && stored.port !== null
        ? { kind: "on" as const, host: stored.host, port: stored.port }
        : { kind: "off" as const };
  return {
    draft,
    hasCredentials:
      (input.credentials?.username ?? "").length > 0 ||
      (input.credentials?.password ?? "").length > 0,
    nativeProxy: input.nativeProxy,
    network: input.network,
    networkDetail: networkDetail(input.network, input.nativeProxy, proxy),
    parse,
    proxy,
    saveDetail: input.saveDetail ?? null,
  };
}

export { emptyProxyDraft };

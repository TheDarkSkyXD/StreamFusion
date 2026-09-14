export type NetworkRead = "online" | "offline";

export type ProxyTransport =
  | { readonly kind: "off" }
  | {
      readonly kind: "on";
      readonly host: string;
      readonly port: number;
    };

export type ProxyCredentials = {
  readonly username: string;
  readonly password: string;
};

export type ProxyDraft = {
  readonly enabled: boolean;
  readonly host: string;
  readonly portText: string;
  readonly username: string;
  readonly password: string;
};

export type ProxyParseResult =
  | { readonly kind: "disabled" }
  | {
      readonly kind: "ready";
      readonly host: string;
      readonly port: number;
    }
  | { readonly kind: "invalid"; readonly reason: string };

export type ConnectivityView = {
  readonly network: NetworkRead;
  readonly networkDetail: string;
  readonly proxy: ProxyTransport;
  readonly draft: ProxyDraft;
  readonly hasCredentials: boolean;
  readonly nativeProxy: "ready" | "unavailable";
  readonly parse: ProxyParseResult;
  readonly saveDetail: string | null;
};

export interface ConnectivitySession {
  load(): Promise<ConnectivityView>;
  saveDraft(draft: ProxyDraft): Promise<ConnectivityView>;
  fetch: typeof globalThis.fetch;
  readNetwork(): Promise<NetworkRead>;
}

import { describe, expect, it } from "vitest";

import { composeConnectivityView } from "../domain/compose-connectivity-view";
import {
  parseProxyDraft,
  parseStoredProxy,
  serializeProxy,
} from "../domain/proxy-config";

describe("parseProxyDraft", () => {
  it("turns the switch off without validating host", () => {
    expect(
      parseProxyDraft({
        enabled: false,
        host: "",
        password: "",
        portText: "",
        username: "",
      }),
    ).toEqual({ kind: "disabled" });
  });

  it("rejects a scheme in the host", () => {
    expect(
      parseProxyDraft({
        enabled: true,
        host: "http://127.0.0.1",
        password: "",
        portText: "8080",
        username: "",
      }).kind,
    ).toBe("invalid");
  });

  it("accepts host and port", () => {
    expect(
      parseProxyDraft({
        enabled: true,
        host: "127.0.0.1",
        password: "",
        portText: "8080",
        username: "",
      }),
    ).toEqual({ kind: "ready", host: "127.0.0.1", port: 8080 });
  });
});

describe("stored proxy", () => {
  it("round-trips version 1 JSON", () => {
    const raw = serializeProxy({
      enabled: true,
      host: "10.0.0.1",
      port: 3128,
    });
    expect(parseStoredProxy(raw)).toEqual({
      enabled: true,
      host: "10.0.0.1",
      port: 3128,
    });
  });

  it("treats unknown JSON as off", () => {
    expect(parseStoredProxy("{")).toEqual({
      enabled: false,
      host: "",
      port: null,
    });
  });
});

describe("composeConnectivityView", () => {
  it("warns when a proxy is on without the native module", () => {
    const view = composeConnectivityView({
      credentials: null,
      nativeProxy: "unavailable",
      network: "online",
      stored: serializeProxy({ enabled: true, host: "127.0.0.1", port: 8080 }),
    });
    expect(view.proxy).toEqual({ kind: "on", host: "127.0.0.1", port: 8080 });
    expect(view.nativeProxy).toBe("unavailable");
    expect(view.networkDetail).toContain("StreamFusion Development");
  });
});

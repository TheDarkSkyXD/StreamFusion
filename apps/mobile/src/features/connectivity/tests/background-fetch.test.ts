import { afterEach, describe, expect, it, vi } from "vitest";

import { backgroundFetch } from "../adapters/background-fetch";

class FakeRequest {
  static requests: FakeRequest[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = "";
  timeout = 0;
  method = "";
  url = "";
  body: string | null = null;
  headers: Record<string, string> = {};
  aborted = false;
  private responseHeaders = "";

  constructor() {
    FakeRequest.requests.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: string | null) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  getAllResponseHeaders() {
    return this.responseHeaders;
  }

  respond(status: number, body: string, headers: string) {
    this.status = status;
    this.responseText = body;
    this.responseHeaders = headers;
    this.onload?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeRequest.requests.length = 0;
});

describe("background fetch", () => {
  it("returns an HTTP response directly from native request callbacks while JS timers are paused", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const pending = backgroundFetch("https://example.com/gql", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: '{"query":"stream"}',
    });
    const request = FakeRequest.requests[0];
    expect(request).toMatchObject({
      method: "POST",
      url: "https://example.com/gql",
      body: '{"query":"stream"}',
      timeout: 30_000,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
    });
    request?.respond(
      503,
      '{"error":"temporarily unavailable"}',
      "Content-Type: application/json\r\nX-Request-Id: abc\r\n",
    );
    const response = await pending;
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("abc");
    expect(await response.text()).toBe('{"error":"temporarily unavailable"}');
  });

  it("aborts an in-flight request through the native transport", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    vi.stubGlobal("DOMException", undefined);
    const controller = new AbortController();
    const pending = backgroundFetch("https://example.com/live", {
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeRequest.requests[0]?.aborted).toBe(true);
  });

  it("rejects a pre-aborted request without starting XHR when DOMException is absent", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    vi.stubGlobal("DOMException", undefined);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      backgroundFetch("https://example.com/live", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeRequest.requests).toEqual([]);
  });

  it("reads a POST Request body when the React Native Request has no body getter", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    class NativeRequest {
      readonly url = "https://example.com/gql";
      readonly method = "POST";
      readonly headers = new Headers({ "Content-Type": "application/json" });
      readonly signal = new AbortController().signal;
      clone() {
        return { text: async () => '{"query":"stream"}' };
      }
    }
    vi.stubGlobal("Request", NativeRequest);
    const pending = backgroundFetch(
      new Request("https://example.com/gql", { method: "POST" }),
    );
    await Promise.resolve();
    const request = FakeRequest.requests[0];
    expect(request).toMatchObject({
      method: "POST",
      body: '{"query":"stream"}',
    });
    request?.respond(200, "{}", "Content-Type: application/json\r\n");
    expect((await pending).status).toBe(200);
  });

  it.each(["error", "timeout"] as const)(
    "settles a native %s without advancing JavaScript timers",
    async (event) => {
      vi.useFakeTimers();
      vi.stubGlobal("XMLHttpRequest", FakeRequest);
      const pending = backgroundFetch("https://example.com/live");
      const request = FakeRequest.requests[0];
      if (event === "error") request?.onerror?.();
      else request?.ontimeout?.();
      await expect(pending).rejects.toMatchObject({ name: "TypeError" });
    },
  );
});

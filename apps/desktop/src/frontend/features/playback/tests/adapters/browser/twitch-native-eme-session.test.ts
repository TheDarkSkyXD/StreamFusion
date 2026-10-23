import { afterEach, describe, expect, it, vi } from "vitest";

import { createTwitchNativeEmeSession } from "../../../adapters/browser/twitch-native-eme-session";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function encrypted(video: HTMLVideoElement, bytes: number[], initDataType = "cenc") {
  video.dispatchEvent(
    Object.assign(new Event("encrypted"), {
      initDataType,
      initData: new Uint8Array(bytes).buffer,
    })
  );
}

function message(session: EventTarget, bytes: number[]) {
  session.dispatchEvent(
    Object.assign(new Event("message"), {
      message: new Uint8Array(bytes).buffer,
      messageType: "license-request",
    })
  );
}

function emeBrowser() {
  const video = document.createElement("video");
  const sessions: ReturnType<typeof fakeSession>[] = [];
  const createSession = vi.fn(() => {
    const session = fakeSession();
    sessions.push(session);
    return session;
  });
  const keys = { createSession };
  const createMediaKeys = vi.fn(async () => keys);
  const requestAccess = vi.fn(async () => ({ createMediaKeys }));
  const setMediaKeys = vi.fn(async (_keys: unknown) => {});
  Object.defineProperty(video, "setMediaKeys", { value: setMediaKeys });
  vi.stubGlobal("navigator", { requestMediaKeySystemAccess: requestAccess });
  return { video, sessions, createSession, createMediaKeys, requestAccess, setMediaKeys };
}

function fakeSession() {
  return Object.assign(new EventTarget(), {
    generateRequest: vi.fn(async (_type: string, _data: Uint8Array) => {}),
    update: vi.fn(async (_license: Uint8Array) => {}),
    close: vi.fn(async () => {}),
    keyStatuses: new Map<Uint8Array, MediaKeyStatus>(),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Twitch native EME session", () => {
  it("installs before HLS, uses temporary Widevine AVC/AAC, and deduplicates equal init data", async () => {
    const browser = emeBrowser();
    const access = deferred<{ createMediaKeys: typeof browser.createMediaKeys }>();
    browser.requestAccess.mockImplementation(() => access.promise);
    const errors = vi.fn();
    const eme = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense: vi.fn(async () => new Uint8Array([9])),
      onError: errors,
    });

    encrypted(browser.video, [1, 2, 3]);
    encrypted(browser.video, [1, 2, 3]);
    expect(browser.createSession).toHaveBeenCalledTimes(0);
    access.resolve({ createMediaKeys: browser.createMediaKeys });
    await eme.ready;
    await vi.waitFor(() => expect(browser.sessions[0]?.generateRequest).toHaveBeenCalledTimes(1));

    expect(browser.requestAccess).toHaveBeenCalledWith("com.widevine.alpha", [
      {
        initDataTypes: ["cenc"],
        distinctiveIdentifier: "not-allowed",
        persistentState: "not-allowed",
        sessionTypes: ["temporary"],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.64002a"' }],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
      },
    ]);
    expect(browser.setMediaKeys).toHaveBeenCalledWith(
      expect.objectContaining({ createSession: browser.createSession })
    );
    expect(browser.createSession).toHaveBeenCalledWith("temporary");
    expect(
      browser.sessions[0]?.generateRequest.mock.calls.map(([type, bytes]) => [
        type,
        [...new Uint8Array(bytes)],
      ])
    ).toEqual([["cenc", [1, 2, 3]]]);
    expect(errors).not.toHaveBeenCalled();
    await eme.dispose();
  });

  it("opens a new temporary session for rotated init data", async () => {
    const browser = emeBrowser();
    const eme = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense: vi.fn(),
      onError: vi.fn(),
    });
    await eme.ready;

    encrypted(browser.video, [1]);
    encrypted(browser.video, [2]);
    await vi.waitFor(() => expect(browser.sessions).toHaveLength(2));
    expect(
      browser.sessions[1]?.generateRequest.mock.calls.map(([type, bytes]) => [
        type,
        [...new Uint8Array(bytes)],
      ])
    ).toEqual([["cenc", [2]]]);
    await eme.dispose();
  });

  it("exchanges binary challenges and handles renewal messages on the same session", async () => {
    const browser = emeBrowser();
    const requestLicense = vi.fn(async (challenge: Uint8Array, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return new Uint8Array([challenge[0] + 10]);
    });
    const eme = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense,
      onError: vi.fn(),
    });
    await eme.ready;
    encrypted(browser.video, [1]);
    const session = browser.sessions[0];
    expect(session).toBeDefined();
    if (!session) throw new Error("session missing");

    message(session, [4]);
    message(session, [5]);
    await vi.waitFor(() => expect(session.update).toHaveBeenCalledTimes(2));
    expect(requestLicense.mock.calls.map(([challenge]) => [...challenge])).toEqual([[4], [5]]);
    expect(session.update.mock.calls.map(([license]) => [...new Uint8Array(license)])).toEqual([
      [14],
      [15],
    ]);
    expect(browser.createSession).toHaveBeenCalledTimes(1);
    await eme.dispose();
  });

  it("reports unusable key statuses and ignores usable and pending statuses", async () => {
    const browser = emeBrowser();
    const onError = vi.fn();
    const eme = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense: vi.fn(),
      onError,
    });
    await eme.ready;
    encrypted(browser.video, [1]);
    const session = browser.sessions[0];
    if (!session) throw new Error("session missing");
    const keyId = new Uint8Array([7]);
    session.keyStatuses.set(keyId, "usable");
    session.dispatchEvent(new Event("keystatuseschange"));
    session.keyStatuses.set(keyId, "status-pending");
    session.dispatchEvent(new Event("keystatuseschange"));
    expect(onError).not.toHaveBeenCalled();

    session.keyStatuses.set(keyId, "output-restricted");
    session.dispatchEvent(new Event("keystatuseschange"));
    expect(onError).toHaveBeenCalledWith({ kind: "key-status", status: "output-restricted" });
    await eme.dispose();
  });

  it("reports license failures and accepts a later renewal challenge", async () => {
    const browser = emeBrowser();
    const onError = vi.fn();
    const requestLicense = vi
      .fn()
      .mockRejectedValueOnce(new Error("license unavailable"))
      .mockResolvedValueOnce(new Uint8Array([8]));
    const eme = createTwitchNativeEmeSession({ video: browser.video, requestLicense, onError });
    await eme.ready;
    encrypted(browser.video, [1]);
    const session = browser.sessions[0];
    if (!session) throw new Error("session missing");

    message(session, [3]);
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "license unavailable" })
      )
    );
    message(session, [4]);
    await vi.waitFor(() => expect(session.update).toHaveBeenCalledTimes(1));
    expect([...session.update.mock.calls[0]![0]]).toEqual([8]);
    await eme.dispose();
  });

  it("retries the same init data after generateRequest fails and closes the failed session", async () => {
    const browser = emeBrowser();
    const onError = vi.fn();
    browser.createSession.mockImplementationOnce(() => {
      const session = fakeSession();
      session.generateRequest.mockRejectedValueOnce(new Error("CDM rejected PSSH"));
      browser.sessions.push(session);
      return session;
    });
    const eme = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense: vi.fn(),
      onError,
    });
    await eme.ready;

    encrypted(browser.video, [1]);
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "CDM rejected PSSH" })
      )
    );
    encrypted(browser.video, [1]);
    await vi.waitFor(() => expect(browser.sessions).toHaveLength(2));
    expect(browser.sessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(browser.sessions[1]?.generateRequest).toHaveBeenCalledTimes(1);
    await eme.dispose();
  });

  it("aborts pending licenses, ignores stale work, and releases keys once", async () => {
    const browser = emeBrowser();
    const license = deferred<Uint8Array>();
    const requestLicense = vi.fn((_challenge: Uint8Array, _signal: AbortSignal) => license.promise);
    const onError = vi.fn();
    const eme = createTwitchNativeEmeSession({ video: browser.video, requestLicense, onError });
    await eme.ready;
    encrypted(browser.video, [1]);
    const session = browser.sessions[0];
    if (!session) throw new Error("session missing");
    message(session, [4]);
    await vi.waitFor(() => expect(requestLicense).toHaveBeenCalledTimes(1));
    const signal = requestLicense.mock.calls[0]?.[1];

    await Promise.all([eme.dispose(), eme.dispose()]);
    expect(signal?.aborted).toBe(true);
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(browser.setMediaKeys).toHaveBeenLastCalledWith(null);
    license.resolve(new Uint8Array([9]));
    await Promise.resolve();
    message(session, [5]);
    encrypted(browser.video, [2]);
    expect(session.update).not.toHaveBeenCalled();
    expect(browser.createSession).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not attach keys after disposal during access negotiation", async () => {
    const browser = emeBrowser();
    const access = deferred<{ createMediaKeys: typeof browser.createMediaKeys }>();
    browser.requestAccess.mockImplementation(() => access.promise);
    const eme = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense: vi.fn(),
      onError: vi.fn(),
    });

    const disposal = eme.dispose();
    access.resolve({ createMediaKeys: browser.createMediaKeys });
    await Promise.all([eme.ready, disposal]);
    expect(browser.setMediaKeys).not.toHaveBeenCalled();
    expect(browser.createSession).not.toHaveBeenCalled();
  });

  it("waits for old key sessions to close before reattaching keys to the same video", async () => {
    const browser = emeBrowser();
    const old = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense: vi.fn(),
      onError: vi.fn(),
    });
    await old.ready;
    encrypted(browser.video, [1]);
    const closing = deferred<void>();
    browser.sessions[0]!.close.mockImplementation(() => closing.promise);
    const disposal = old.dispose();
    const next = createTwitchNativeEmeSession({
      video: browser.video,
      requestLicense: vi.fn(),
      onError: vi.fn(),
    });
    await Promise.resolve();
    expect(browser.setMediaKeys).toHaveBeenCalledTimes(1);
    closing.resolve();
    await disposal;
    await next.ready;
    expect(
      browser.setMediaKeys.mock.calls.map(([keys]) => (keys === null ? "clear" : "attach"))
    ).toEqual(["attach", "clear", "attach"]);
    await next.dispose();
  });
});

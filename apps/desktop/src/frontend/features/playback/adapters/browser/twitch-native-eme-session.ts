export interface TwitchNativeEmeSession {
  ready: Promise<void>;
  dispose(): Promise<void>;
}

interface TwitchNativeEmeOptions {
  video: HTMLVideoElement;
  requestLicense(challenge: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
  onError(error: unknown): void;
}

const widevineConfiguration: MediaKeySystemConfiguration = {
  initDataTypes: ["cenc"],
  distinctiveIdentifier: "not-allowed",
  persistentState: "not-allowed",
  sessionTypes: ["temporary"],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.64002a"' }],
  audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
};

const videoOwnership = new WeakMap<HTMLVideoElement, Promise<void>>();

export function createTwitchNativeEmeSession({
  video,
  requestLicense,
  onError,
}: TwitchNativeEmeOptions): TwitchNativeEmeSession {
  const previousOwner = videoOwnership.get(video) ?? Promise.resolve();
  let releaseOwnership!: () => void;
  const ownership = new Promise<void>((resolve) => {
    releaseOwnership = resolve;
  });
  videoOwnership.set(video, ownership);
  const controller = new AbortController();
  const seenInitData = new Set<string>();
  const sessions = new Set<MediaKeySession>();
  const removeSessionListeners = new Map<MediaKeySession, () => void>();
  const pendingInitData: Array<{ type: string; bytes: Uint8Array<ArrayBuffer> }> = [];
  let lifecycle: "active" | "disposed" = "active";
  let keys: MediaKeys | null = null;
  let keysAttached = false;
  let disposal: Promise<void> | null = null;

  function isActive(): boolean {
    return lifecycle === "active";
  }

  function startSession(type: string, bytes: Uint8Array<ArrayBuffer>): void {
    if (!isActive() || !keys) return;
    const fingerprint = `${type}:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (seenInitData.has(fingerprint)) return;

    const session = keys.createSession("temporary");
    seenInitData.add(fingerprint);
    sessions.add(session);
    let updates = Promise.resolve();

    function onMessage(event: MediaKeyMessageEvent): void {
      const challenge = new Uint8Array(event.message.slice(0));
      updates = updates
        .then(async () => {
          if (!isActive()) return;
          const license = await requestLicense(challenge, controller.signal);
          if (!isActive()) return;
          await session.update(new Uint8Array(license));
        })
        .catch((error: unknown) => {
          if (isActive()) onError(error);
        });
    }

    function onKeyStatusesChange(): void {
      if (!isActive()) return;
      for (const status of session.keyStatuses.values()) {
        if (status !== "usable" && status !== "status-pending" && status !== "usable-in-future") {
          onError({ kind: "key-status", status });
        }
      }
    }

    session.addEventListener("message", onMessage);
    session.addEventListener("keystatuseschange", onKeyStatusesChange);
    removeSessionListeners.set(session, () => {
      session.removeEventListener("message", onMessage);
      session.removeEventListener("keystatuseschange", onKeyStatusesChange);
    });
    void session.generateRequest(type, bytes).catch((error: unknown) => {
      if (!isActive()) return;
      seenInitData.delete(fingerprint);
      removeSessionListeners.get(session)?.();
      removeSessionListeners.delete(session);
      sessions.delete(session);
      void session.close().catch(onError);
      onError(error);
    });
  }

  function onEncrypted(event: MediaEncryptedEvent): void {
    if (!isActive() || !event.initData) return;
    const bytes = new Uint8Array(event.initData.slice(0));
    if (keys) {
      try {
        startSession(event.initDataType, bytes);
      } catch (error) {
        onError(error);
      }
    } else {
      pendingInitData.push({ type: event.initDataType, bytes });
    }
  }

  video.addEventListener("encrypted", onEncrypted);

  const ready = (async () => {
    try {
      await previousOwner;
      if (!isActive()) return;
      const access = await navigator.requestMediaKeySystemAccess("com.widevine.alpha", [
        widevineConfiguration,
      ]);
      if (!isActive()) return;
      const mediaKeys = await access.createMediaKeys();
      if (!isActive()) return;
      await video.setMediaKeys(mediaKeys);
      keysAttached = true;
      if (!isActive()) return;
      keys = mediaKeys;
      for (const { type, bytes } of pendingInitData) {
        try {
          startSession(type, bytes);
        } catch (error) {
          onError(error);
        }
      }
      pendingInitData.length = 0;
    } catch (error) {
      if (!isActive()) return;
      onError(error);
      throw error;
    }
  })();

  function dispose(): Promise<void> {
    if (disposal) return disposal;
    lifecycle = "disposed";
    controller.abort();
    video.removeEventListener("encrypted", onEncrypted);
    pendingInitData.length = 0;
    for (const remove of removeSessionListeners.values()) remove();
    removeSessionListeners.clear();
    disposal = (async () => {
      try {
        await ready.catch(() => {});
        const results = await Promise.allSettled(
          Array.from(sessions, (session) => session.close())
        );
        for (const result of results) {
          if (result.status === "rejected") onError(result.reason);
        }
        if (keysAttached) {
          try {
            await video.setMediaKeys(null);
          } catch (error) {
            onError(error);
          }
        }
      } finally {
        releaseOwnership();
        if (videoOwnership.get(video) === ownership) videoOwnership.delete(video);
      }
    })();
    return disposal;
  }

  return { ready, dispose };
}

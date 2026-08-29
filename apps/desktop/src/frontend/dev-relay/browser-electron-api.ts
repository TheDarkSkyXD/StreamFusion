import { rewriteDevBrowserPlaybackValue } from "@/lib/dev-browser-media-url";
import type { ElectronAPI } from "@backend/preload";
import { getModerationBrowserFixture } from "./moderation-browser-fixtures";
import { getUserProfileFixture } from "./user-profile-fixtures";

export interface BrowserRelayClient {
  call(path: readonly string[], args: readonly unknown[]): Promise<unknown>;
  subscribe(
    path: readonly string[],
    args: readonly unknown[],
    listener: (...eventArgs: unknown[]) => void
  ): () => void;
}

const NOOP = () => undefined;
const LOCAL_VOID_METHODS = new Set([
  "minimizeWindow",
  "maximizeWindow",
  "closeWindow",
  "toggleDevTools",
]);
const PLAYBACK_METHODS = new Set([
  "clips.getPlaybackUrl",
  "streams.getPlaybackUrl",
  "videos.getPlaybackUrl",
]);

function createMethodProxy(
  client: BrowserRelayClient,
  path: readonly string[],
  fixtureSearch: string
): unknown {
  return new Proxy(NOOP, {
    get(_target, property) {
      if (property === "then") return undefined;
      return createMethodProxy(client, [...path, String(property)], fixtureSearch);
    },
    apply(_target, _thisArg, rawArgs: unknown[]) {
      const method = path.at(-1) ?? "";
      if (path.length === 1 && LOCAL_VOID_METHODS.has(method)) return undefined;
      if (path.length === 1 && method === "isMaximized") return Promise.resolve(false);
      if (path.length === 1 && method === "onMaximizeChange") return NOOP;

      if (path[0] === "slot") {
        if (method.startsWith("on")) return NOOP;
        if (method === "isWcvEnabled") return Promise.resolve(false);
        return Promise.resolve(undefined);
      }

      const fixture = getUserProfileFixture(path, fixtureSearch);
      if (fixture.matched) return Promise.resolve(fixture.value);
      const moderationFixture = getModerationBrowserFixture(path, rawArgs, fixtureSearch);
      if (moderationFixture.matched) return Promise.resolve(moderationFixture.value);

      const callbackIndex = rawArgs.findIndex((argument) => typeof argument === "function");
      if (callbackIndex >= 0) {
        const callback = rawArgs[callbackIndex] as (...eventArgs: unknown[]) => void;
        const args = rawArgs.filter((_argument, index) => index !== callbackIndex);
        return client.subscribe(path, args, callback);
      }
      const result = client.call(path, rawArgs);
      return PLAYBACK_METHODS.has(path.join("."))
        ? result.then(rewriteDevBrowserPlaybackValue)
        : result;
    },
  });
}

export function createBrowserElectronApi(
  client: BrowserRelayClient,
  fixtureSearch = globalThis.location?.search ?? ""
): ElectronAPI {
  return createMethodProxy(client, [], fixtureSearch) as ElectronAPI;
}

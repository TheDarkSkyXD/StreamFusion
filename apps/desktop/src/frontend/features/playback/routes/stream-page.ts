import { createPreloadableRoute } from "@/routes/preloadable-route";
import type { ChatPlatform } from "@shared/chat-types";

let streamPageModulePromise: Promise<typeof import("../../../pages/Stream")> | undefined;
const loadStreamPageModule = () =>
  (streamPageModulePromise ??= import("../../../pages/Stream"));
const streamPageRoute = createPreloadableRoute(() =>
  loadStreamPageModule().then((module) => ({ default: module.StreamPage }))
);

export function preloadStreamPage(platform?: ChatPlatform): Promise<void> {
  return Promise.all([
    streamPageRoute.preload(),
    loadStreamPageModule().then((module) => module.preloadChatPanel(platform)),
  ]).then(() => undefined);
}

export const StreamPage = Object.assign(streamPageRoute.Component, {
  preload: preloadStreamPage,
});

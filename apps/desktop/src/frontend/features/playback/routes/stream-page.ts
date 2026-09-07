import { createPreloadableRoute } from "@/routes/preloadable-route";
import { preloadChatPanel } from "@/features/playback/components/screens/Stream/preload-chat-panel";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";

let streamPageModulePromise: Promise<typeof import("../components/screens/Stream")> | undefined;
const loadStreamPageModule = () =>
  (streamPageModulePromise ??= import("../components/screens/Stream"));
const streamPageRoute = createPreloadableRoute(() =>
  loadStreamPageModule().then((module) => ({ default: module.StreamPage }))
);

export function preloadStreamPage(platform?: ChatPlatform): Promise<void> {
  return Promise.all([streamPageRoute.preload(), preloadChatPanel(platform)]).then(() => undefined);
}

export const StreamPage = Object.assign(streamPageRoute.Component, {
  preload: preloadStreamPage,
});

import {
  preloadChatService,
  shutdownLoadedChatServices,
} from "@backend/services/chat/chat-service-loader";
import { registerAppShutdownTask } from "@/features/shell/utils/app-shutdown-registry";
import type { ChatPlatform } from "@shared/chat-types";

let kickChatComponentPromise:
  Promise<{ default: typeof import("./kick/KickChat").KickChat }> | undefined;
let twitchChatComponentPromise:
  Promise<{ default: typeof import("./twitch/TwitchChat").TwitchChat }> | undefined;

export const loadKickChatComponent = () =>
  (kickChatComponentPromise ??= Promise.all([
    import("./kick/KickChat"),
    preloadChatService("kick"),
  ]).then(([module]) => ({ default: module.KickChat })));

export const loadTwitchChatComponent = () =>
  (twitchChatComponentPromise ??= Promise.all([
    import("./twitch/TwitchChat"),
    preloadChatService("twitch"),
  ]).then(([module]) => ({ default: module.TwitchChat })));

export function preloadPlatformChat(platform: ChatPlatform): Promise<void> {
  const componentPromise =
    platform === "kick" ? loadKickChatComponent() : loadTwitchChatComponent();
  return Promise.all([componentPromise, preloadChatService(platform)]).then(() => undefined);
}

registerAppShutdownTask("chat-services", shutdownLoadedChatServices);

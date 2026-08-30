import type { ChatConnectionStatus, ChatPlatform, RoomStatePatchEvent } from "@shared/chat-types";

type KickChatModule = typeof import("./kick-chat");
type TwitchChatModule = typeof import("./twitch-chat");

export interface ChatRoomStateEventSource {
  on(event: "roomState", listener: (event: RoomStatePatchEvent) => void): void;
  on(event: "connectionStateChange", listener: (status: ChatConnectionStatus) => void): void;
  off(event: "roomState", listener: (event: RoomStatePatchEvent) => void): void;
  off(event: "connectionStateChange", listener: (status: ChatConnectionStatus) => void): void;
  getConnectionStatus?(): ChatConnectionStatus;
}

let kickChatModulePromise: Promise<KickChatModule> | undefined;
let twitchChatModulePromise: Promise<TwitchChatModule> | undefined;
let loadedKickChatModule: KickChatModule | undefined;
let loadedTwitchChatModule: TwitchChatModule | undefined;

export function loadKickChatModule(): Promise<KickChatModule> {
  return (kickChatModulePromise ??= import("./kick-chat").then((module) => {
    loadedKickChatModule = module;
    return module;
  }));
}

export function loadTwitchChatModule(): Promise<TwitchChatModule> {
  return (twitchChatModulePromise ??= import("./twitch-chat").then((module) => {
    loadedTwitchChatModule = module;
    return module;
  }));
}

export function getLoadedKickChatModule(): KickChatModule | undefined {
  return loadedKickChatModule;
}

export function getLoadedTwitchChatModule(): TwitchChatModule | undefined {
  return loadedTwitchChatModule;
}

export function getLoadedChatRoomStateEventSource(
  platform: ChatPlatform
): ChatRoomStateEventSource | undefined {
  return platform === "kick"
    ? loadedKickChatModule?.kickChatService
    : loadedTwitchChatModule?.twitchChatService;
}

export async function loadChatRoomStateEventSource(
  platform: ChatPlatform
): Promise<ChatRoomStateEventSource> {
  if (platform === "kick") return (await loadKickChatModule()).kickChatService;
  return (await loadTwitchChatModule()).twitchChatService;
}

export function preloadChatService(platform: ChatPlatform): Promise<void> {
  const modulePromise = platform === "kick" ? loadKickChatModule() : loadTwitchChatModule();
  return modulePromise.then(() => undefined);
}

export async function shutdownLoadedChatServices(): Promise<void> {
  const shutdowns: Promise<void>[] = [];
  if (kickChatModulePromise) {
    shutdowns.push(
      kickChatModulePromise.then(({ kickChatService }) => kickChatService.forceShutdown())
    );
  }
  if (twitchChatModulePromise) {
    shutdowns.push(
      twitchChatModulePromise.then(({ twitchChatService }) => twitchChatService.forceShutdown())
    );
  }
  await Promise.allSettled(shutdowns);
}

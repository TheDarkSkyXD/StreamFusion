import { Platform as ChatPlatform } from "@streamfusion/core/platform";

export function preloadChatPanel(platform?: ChatPlatform): Promise<unknown> {
  return Promise.all([
    import("@/features/chat/components/chat/ChatPanel"),
    platform
      ? import("@/features/chat/components/chat/platform-chat-loader").then((module) =>
          module.preloadPlatformChat(platform)
        )
      : undefined,
  ]);
}

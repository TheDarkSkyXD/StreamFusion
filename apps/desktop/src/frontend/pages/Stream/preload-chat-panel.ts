import type { ChatPlatform } from "@shared/chat-types";

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

import type { PlatformWorkflowNavigation } from "../capabilities/workflow-navigation";

export function createPlatformWorkflowNavigation(
  openUrl: (url: string) => Promise<void>,
): PlatformWorkflowNavigation {
  return {
    openChannel(channel) {
      return openUrl(
        channel.platform === "twitch"
          ? `https://www.twitch.tv/${encodeURIComponent(channel.login)}`
          : `https://kick.com/${encodeURIComponent(channel.login)}`,
      );
    },
    openModeration(channel, platform) {
      return openUrl(
        platform === "twitch" && channel
          ? `https://www.twitch.tv/moderator/${encodeURIComponent(channel.login)}`
          : platform === "kick" && channel
            ? `https://kick.com/${encodeURIComponent(channel.login)}`
            : platform === "twitch"
              ? "https://www.twitch.tv"
              : "https://kick.com",
      );
    },
  };
}

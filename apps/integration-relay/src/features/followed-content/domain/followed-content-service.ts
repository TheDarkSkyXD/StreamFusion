import type {
  FollowedContentCatalog,
  FollowedContentRead,
  FollowedContentReadResult,
  FollowedPlatform
} from "../capabilities/followed-content-catalog";

export function createFollowedContentService(input: {
  readonly catalogs: readonly FollowedContentCatalog[];
}) {
  const catalogs = new Map<FollowedPlatform, FollowedContentCatalog>(
    input.catalogs.map((catalog) => [catalog.platform, catalog])
  );

  return {
    async read(
      command: FollowedContentRead
    ): Promise<FollowedContentReadResult> {
      const catalog = catalogs.get(command.platform);
      if (catalog === undefined) return { kind: "unavailable" };
      if (command.kind === "streams") {
        const body = await catalog.followedStreams(command.refs);
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: "streams" };
      }
      if (command.kind === "channels") {
        const body = await catalog.followedChannels(command.refs);
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: "channels" };
      }
      if (command.kind === "videos") {
        const body = await catalog.followedVideos({
          channelId: command.channelId,
          sort: command.sort
        });
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: "videos" };
      }
      const body = await catalog.followedClips({
        channelId: command.channelId,
        period: command.period,
        sort: command.sort
      });
      return body === null ? { kind: "unavailable" } : { body, kind: "clips" };
    }
  };
}

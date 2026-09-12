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
      const body = await readBody(catalog, command);
      return body === null
        ? { kind: "unavailable" }
        : { body, kind: command.kind };
    }
  };
}

async function readBody(
  catalog: FollowedContentCatalog,
  command: FollowedContentRead
) {
  if (command.kind === "streams") return catalog.followedStreams(command.refs);
  if (command.kind === "channels") {
    return catalog.followedChannels(command.refs);
  }
  if (command.kind === "videos") {
    return catalog.followedVideos({
      channelId: command.channelId,
      sort: command.sort
    });
  }
  return catalog.followedClips({
    channelId: command.channelId,
    period: command.period,
    sort: command.sort
  });
}

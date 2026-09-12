import type {
  DiscoveryCatalog,
  DiscoveryPlatform,
  DiscoveryRead,
  DiscoveryReadResult
} from "../capabilities/discovery-catalog";

export function createSignedOutDiscoveryService(input: {
  readonly catalogs: readonly DiscoveryCatalog[];
}) {
  const catalogs = new Map<DiscoveryPlatform, DiscoveryCatalog>(
    input.catalogs.map((catalog) => [catalog.platform, catalog])
  );

  return {
    async read(command: DiscoveryRead): Promise<DiscoveryReadResult> {
      const catalog = catalogs.get(command.platform);
      if (catalog === undefined) return { kind: "unavailable" };
      return dispatchRead(catalog, command);
    }
  };
}

async function dispatchRead(
  catalog: DiscoveryCatalog,
  command: DiscoveryRead
): Promise<DiscoveryReadResult> {
  if (command.kind === "top-streams") {
    return wrap(command.kind, await catalog.topStreams());
  }
  if (command.kind === "categories") {
    return wrap(
      command.kind,
      await catalog.categories(
        command.cursor === undefined ? {} : { cursor: command.cursor }
      )
    );
  }
  if (command.kind === "search") {
    return wrap(command.kind, await catalog.search({ query: command.query }));
  }
  if (command.kind === "category") {
    return wrap(
      command.kind,
      await catalog.category({ categoryId: command.categoryId })
    );
  }
  return dispatchMedia(catalog, command);
}

async function dispatchMedia(
  catalog: DiscoveryCatalog,
  command: Extract<
    DiscoveryRead,
    | { kind: "category-streams" }
    | { kind: "category-clips" }
    | { kind: "category-videos" }
  >
): Promise<DiscoveryReadResult> {
  if (command.kind === "category-streams") {
    return wrap(
      command.kind,
      await catalog.categoryStreams({
        categoryId: command.categoryId,
        ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
        ...(command.language === undefined ? {} : { language: command.language })
      })
    );
  }
  if (command.kind === "category-clips") {
    return wrap(
      command.kind,
      await catalog.categoryClips({
        categoryId: command.categoryId,
        timeRange: command.timeRange,
        ...(command.cursor === undefined ? {} : { cursor: command.cursor })
      })
    );
  }
  return wrap(
    command.kind,
    await catalog.categoryVideos({
      categoryId: command.categoryId,
      sort: command.sort,
      ...(command.cursor === undefined ? {} : { cursor: command.cursor })
    })
  );
}

function wrap<TKind extends Exclude<DiscoveryReadResult["kind"], "unavailable">>(
  kind: TKind,
  body: Extract<DiscoveryReadResult, { kind: TKind }>["body"] | null
): DiscoveryReadResult {
  return body === null
    ? { kind: "unavailable" }
    : ({ body, kind } as DiscoveryReadResult);
}

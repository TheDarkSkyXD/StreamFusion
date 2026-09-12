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
      if (command.kind === "top-streams") {
        const body = await catalog.topStreams();
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: command.kind };
      }
      if (command.kind === "categories") {
        const body = await catalog.categories();
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: command.kind };
      }
      if (command.kind === "search") {
        const body = await catalog.search({ query: command.query });
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: command.kind };
      }
      if (command.kind === "channel") {
        const body = await catalog.channel(command.lookup);
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: command.kind };
      }
      if (command.kind === "channel-videos") {
        const body = await catalog.videos(command.lookup);
        return body === null
          ? { kind: "unavailable" }
          : { body, kind: command.kind };
      }
      const body = await catalog.clips(command.lookup);
      return body === null
        ? { kind: "unavailable" }
        : { body, kind: command.kind };
    }
  };
}

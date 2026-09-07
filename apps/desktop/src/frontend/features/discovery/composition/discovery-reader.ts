import type { DiscoveryReader } from "../capabilities/discovery-reader";
import { discoveryCatalogGateway } from "../adapters/electron/discovery-catalog-gateway";

export const discoveryReader: DiscoveryReader = discoveryCatalogGateway;

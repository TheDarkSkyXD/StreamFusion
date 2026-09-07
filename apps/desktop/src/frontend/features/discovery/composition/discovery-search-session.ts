import type { DiscoverySearchSession } from "../capabilities/search-session";
import { discoverySearchSessionGateway } from "../adapters/electron/discovery-search-session";

export const discoverySearchSession: DiscoverySearchSession = discoverySearchSessionGateway;

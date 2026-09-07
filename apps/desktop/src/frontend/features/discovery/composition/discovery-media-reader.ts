import type { DiscoveryMediaReader } from "../capabilities/discovery-media-reader";
import { desktopDiscoveryMediaReader } from "../adapters/electron/discovery-media-reader";

export const discoveryMediaReader: DiscoveryMediaReader = desktopDiscoveryMediaReader;

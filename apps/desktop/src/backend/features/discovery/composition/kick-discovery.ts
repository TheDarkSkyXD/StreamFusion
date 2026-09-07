import { kickTransport } from "@backend/api/platforms/kick/kick-transport";
import { KickDiscovery } from "../adapters/kick/kick-discovery-reader";
export const kickDiscovery = new KickDiscovery(kickTransport);

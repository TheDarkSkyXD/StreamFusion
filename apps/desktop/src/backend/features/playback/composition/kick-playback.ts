import { kickDiscovery } from "@backend/features/discovery/composition/kick-discovery";
import { KickPlayback } from "../adapters/kick/kick-playback-reader";
export const kickPlayback = new KickPlayback(kickDiscovery);

// Module-singleton registry of platform readers. Adapters self-register at module load.

import type { Platform } from "../../../shared/auth-types";
import type { IPlatformReader } from "./platform-reader";

const readers = new Map<Platform, IPlatformReader>();

export const clients = {
  register(reader: IPlatformReader): void {
    readers.set(reader.platform, reader);
  },
  for(platform: Platform): IPlatformReader {
    const reader = readers.get(platform);
    if (!reader) throw new Error(`No platform reader registered for ${platform}`);
    return reader;
  },
  all(): IPlatformReader[] {
    return Array.from(readers.values());
  },
  has(platform: Platform): boolean {
    return readers.has(platform);
  },
};

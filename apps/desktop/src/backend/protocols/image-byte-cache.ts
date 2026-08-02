interface CachedImageBytes {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  expiresAt: number;
}

const MAX_IMAGE_CACHE_ENTRIES = 64;
const MAX_IMAGE_CACHE_BYTES = 32 * 1024 * 1024;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Shared main-process cache for custom image protocols. Chromium does not
 * consistently reuse custom-scheme responses across remounts, so retaining a
 * bounded copy avoids another CDN round trip for thumbnails already shown.
 */
class ImageByteCache {
  private readonly entries = new Map<string, CachedImageBytes>();
  private byteCount = 0;

  get(key: string): CachedImageBytes | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.delete(key, entry);
      return undefined;
    }

    // Refresh LRU order without extending the response TTL.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): void {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_CACHE_BYTES) return;

    const existing = this.entries.get(key);
    if (existing) this.delete(key, existing);
    const entry = {
      bytes,
      contentType,
      expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
    };
    this.entries.set(key, entry);
    this.byteCount += bytes.byteLength;

    while (this.entries.size > MAX_IMAGE_CACHE_ENTRIES || this.byteCount > MAX_IMAGE_CACHE_BYTES) {
      const oldest = this.entries.entries().next().value as [string, CachedImageBytes] | undefined;
      if (!oldest) break;
      this.delete(oldest[0], oldest[1]);
    }
  }

  clear(): void {
    this.entries.clear();
    this.byteCount = 0;
  }

  private delete(key: string, entry: CachedImageBytes): void {
    if (!this.entries.delete(key)) return;
    this.byteCount -= entry.bytes.byteLength;
  }
}

export const imageByteCache = new ImageByteCache();

export function resetImageByteCacheForTests(): void {
  imageByteCache.clear();
}

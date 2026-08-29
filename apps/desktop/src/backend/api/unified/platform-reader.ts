// Common read-side seam every platform adapter implements. Methods throw on error — no envelope.

import type { Platform } from "../../../shared/auth-types";
import type { UnifiedStream } from "../../../shared/platform-types";

export interface PageOptions {
  limit?: number;
  cursor?: string;
}

export interface PageResult<T> {
  data: T[];
  cursor?: string;
}

export interface TopStreamsOptions extends PageOptions {
  categoryId?: string;
  language?: string;
}

export interface IPlatformReader {
  readonly platform: Platform;
  isAuthenticated(): boolean;
  getTopStreams(options?: TopStreamsOptions): Promise<PageResult<UnifiedStream>>;
}

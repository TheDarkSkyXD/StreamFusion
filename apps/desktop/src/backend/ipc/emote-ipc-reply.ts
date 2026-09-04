import { randomUUID } from "node:crypto";

import { logger } from "@backend/logging/logger";
import { BoundedReadError } from "@backend/reliability/bounded-json-read";
import { Platform } from "@streamfusion/core/platform";
import {
  AppErrorCode,
  Result as IpcReply,
  RetryDecision as RetryAdvice,
} from "@streamfusion/core/reliability";

function classifyBoundedRead(error: BoundedReadError): {
  code: AppErrorCode;
  retry: RetryAdvice;
} {
  switch (error.code) {
    case "canceled":
      return { code: "canceled", retry: { kind: "none" } };
    case "timeout":
      return { code: "timeout", retry: { kind: "manual" } };
    case "response_too_large":
    case "invalid_json":
    case "upstream_schema":
      return { code: "upstream_schema", retry: { kind: "manual" } };
    case "http":
      if (error.status === 401) return { code: "unauthenticated", retry: { kind: "manual" } };
      if (error.status === 403) return { code: "forbidden", retry: { kind: "none" } };
      if (error.status === 404) return { code: "not_found", retry: { kind: "none" } };
      if (error.status === 429) return { code: "rate_limited", retry: { kind: "manual" } };
      if (
        error.status === 408 ||
        error.status === 425 ||
        (error.status !== undefined && error.status >= 500)
      ) {
        return { code: "transient", retry: { kind: "manual" } };
      }
      return { code: "internal", retry: { kind: "manual" } };
    default: {
      const exhaustive: never = error.code;
      return exhaustive;
    }
  }
}

export async function readEmoteReply<T>(
  dependency: string,
  read: () => Promise<T>,
  platform?: Platform
): Promise<IpcReply<T>> {
  try {
    return { kind: "ok", value: await read() };
  } catch (error) {
    const diagnosticId = randomUUID();
    const classification =
      error instanceof BoundedReadError
        ? classifyBoundedRead(error)
        : { code: "transient" as const, retry: { kind: "manual" as const } };
    logger.warn("IPC:Emotes", "Emote provider read failed", {
      dependency,
      diagnosticId,
      error:
        error instanceof BoundedReadError
          ? { name: error.name, code: error.code, status: error.status }
          : error instanceof Error
            ? { name: error.name }
            : undefined,
    });
    return {
      kind: "error",
      error: { ...classification, diagnosticId, ...(platform ? { platform } : {}) },
    };
  }
}

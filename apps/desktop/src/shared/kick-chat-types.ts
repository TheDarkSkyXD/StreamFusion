export type KickSendResult =
  | { ok: true; messageId: string | undefined }
  | {
      ok: false;
      kind:
        | "setup-required"
        | "auth-expired"
        | "rate-limited"
        | "forbidden"
        | "network"
        | "unknown";
      message: string;
      retryAfterSeconds?: number;
    };

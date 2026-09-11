import { describe, expect, it, vi } from "vitest";

import { createKickOAuthApi } from "../adapters/kick/kick-oauth-api";

function signal() {
  return { aborted: false, onCancel: () => () => undefined };
}

describe("createKickOAuthApi", () => {
  it("posts the authorization code to the Worker token boundary", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        scope: ["user:read"],
      }),
    );
    const api = createKickOAuthApi({
      fetcher,
      workerBaseUrl: "https://worker.test",
    });
    const result = await api.exchange({
      code: "kick-code",
      codeVerifier: "a".repeat(43),
      redirectUri:
        "https://streamfusion.leveluptogetherbiz.workers.dev/auth/kick/android/callback",
      signal: signal(),
    });
    expect(result).toEqual({
      kind: "exchanged",
      accessToken: "access",
      refreshToken: "refresh",
      expiresInSeconds: 3600,
      scopes: ["user:read"],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://worker.test/auth/kick/token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

/**
 * Token Status IPC Handler (Xtra port U14)
 *
 * One read-only channel that powers the Settings → API / Tokens panel. Per
 * platform it reports connected/valid + login/userId/scopes/expiry — and
 * NOTHING that could leak a credential. The strict `TokenStatusResult` shape
 * enforces "no token value crosses IPC" (R28); a test asserts the shape too.
 *
 * Validation differs by platform (handled in `tokenExchangeService`):
 *   - Twitch → `id.twitch.tv/oauth2/validate` (OAuth bearer header only, no
 *     Client-Id). login/user_id/scopes/expiry come from the /validate body.
 *   - Kick → current-user re-fetch (no /validate analogue); expiry falls back
 *     to the STORED token's `expiresAt`.
 *
 * SECURITY: validates `event.senderFrame.url` like the proxy handlers (the
 * AUTH_GET_TOKEN no-sender-origin learning — we do NOT add another
 * unauthenticated privileged channel).
 */

import { trustedIpcMain as ipcMain } from "@backend/ipc/trusted-ipc-main";

import { tokenExchangeService } from "@backend/features/authentication/composition/auth-runtime";
import { authenticationRepository } from "@backend/features/authentication/data/authentication-repository";
import { isAllowedSender } from "@backend/ipc/sender-origin";
import { logger } from "@backend/logging/logger";
import { IPC_CHANNELS, type TokenStatusResult } from "@shared/ipc-channels";
import { Platform } from "@streamfusion/core/platform";

export function registerTokenStatusHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.AUTH_TOKEN_STATUS,
    async (event, { platform }: { platform: Platform }): Promise<TokenStatusResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:TokenStatus", "AUTH_TOKEN_STATUS rejected: disallowed sender origin");
        // Benign no-op: report not-connected without touching tokens.
        return { platform, connected: false, valid: false };
      }

      // Not signed in → no token to validate.
      if (!authenticationRepository.hasToken(platform)) {
        return { platform, connected: false, valid: false };
      }

      const token = authenticationRepository.getToken(platform);
      if (!token) {
        // hasToken was true but the token failed to decrypt — treat as
        // connected-but-invalid so the panel offers a reconnect.
        return { platform, connected: true, valid: false };
      }

      const report = await tokenExchangeService.getTokenStatus(platform, token);

      // Build the strict result by hand. We deliberately do NOT spread `token`
      // or any object that holds the access/refresh token — only the report's
      // status/identity/expiry fields cross IPC.
      return {
        platform,
        connected: true,
        valid: report.valid,
        login: report.login,
        userId: report.userId,
        scopes: report.scopes,
        expiresAt: report.expiresAt,
      };
    }
  );
}

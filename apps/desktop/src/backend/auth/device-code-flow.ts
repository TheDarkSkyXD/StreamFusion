/**
 * Device Code Grant Flow Service
 *
 * Implements Twitch's Device Code Grant Flow (DCF) for desktop applications.
 * This flow is designed for devices without browsers or with limited input.
 * It allows users to authorize on a secondary device (like their phone or computer).
 *
 * Flow:
 * 1. Request device code from Twitch
 * 2. Display code and URL to user
 * 3. User goes to twitch.tv/activate and enters code
 * 4. Poll Twitch for token until authorized or expired
 *
 * @see https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow
 */

import { logger } from "@/backend/logging/logger";
import { createManagedInterval } from "@/lib/managed-interval";
import type { AuthToken } from "../../shared/auth-types";
import { getOAuthConfig } from "./oauth-config";
import type { TwitchDeviceAuthWindowHandle } from "./twitch-device-auth-window";

// ========== Types ==========

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

type DeviceCodeStatusHandler = (
  status: "pending" | "authorized" | "expired" | "error",
  message?: string
) => void;

export interface TwitchDeviceCodeLoginDependencies {
  requestDeviceCode: (scopes: string[]) => Promise<DeviceCodeResult>;
  openVerificationWindow: () => Promise<TwitchDeviceAuthWindowHandle>;
  pollForToken: (
    deviceCode: string,
    interval: number,
    expiresIn: number,
    scopes: string[],
    onStatusChange?: DeviceCodeStatusHandler,
    signal?: AbortSignal
  ) => Promise<AuthToken>;
}

const POPUP_CLOSED_ABORT_REASON = Symbol("twitch-device-auth-popup-closed");

function buildTwitchVerificationUrl(device: DeviceCodeResult): string {
  let verificationUrl: URL;
  try {
    verificationUrl = new URL(device.verificationUri);
  } catch {
    throw new Error("Invalid Twitch verification URL");
  }

  if (
    verificationUrl.protocol !== "https:" ||
    verificationUrl.hostname !== "www.twitch.tv" ||
    verificationUrl.port !== "" ||
    verificationUrl.username !== "" ||
    verificationUrl.password !== "" ||
    verificationUrl.pathname !== "/activate"
  ) {
    throw new Error("Invalid Twitch verification URL");
  }

  verificationUrl.search = "";
  verificationUrl.hash = "";
  verificationUrl.searchParams.set("public", "true");
  verificationUrl.searchParams.set("device-code", device.userCode);
  return verificationUrl.toString();
}

export async function runTwitchDeviceCodeLogin(
  scopes: string[],
  dependencies: TwitchDeviceCodeLoginDependencies,
  onStatusChange?: DeviceCodeStatusHandler
): Promise<AuthToken> {
  const startedAt = Date.now();
  const popup = await dependencies.openVerificationWindow();
  logger.info("Auth:DeviceCode", "Twitch device authorization stage", {
    stage: "popup-opened",
    elapsedMs: Date.now() - startedAt,
  });
  const cancellation = new AbortController();
  void popup.closed.then(() => cancellation.abort(POPUP_CLOSED_ABORT_REASON));
  try {
    logger.info("Auth:DeviceCode", "Twitch device authorization stage", {
      stage: "requesting-device-code",
      elapsedMs: Date.now() - startedAt,
    });
    const device = await dependencies.requestDeviceCode(scopes);
    if (cancellation.signal.aborted) throw new Error("Authorization cancelled");
    logger.info("Auth:DeviceCode", "Twitch device authorization stage", {
      stage: "device-code-received",
      elapsedMs: Date.now() - startedAt,
    });
    await popup.navigate(buildTwitchVerificationUrl(device));
    const token = await dependencies.pollForToken(
      device.deviceCode,
      device.interval,
      device.expiresIn,
      scopes,
      onStatusChange,
      cancellation.signal
    );
    logger.info("Auth:DeviceCode", "Twitch device authorization stage", {
      stage: "token-settled",
      elapsedMs: Date.now() - startedAt,
    });
    return token;
  } finally {
    popup.close();
    logger.info("Auth:DeviceCode", "Twitch device authorization stage", {
      stage: "popup-close-requested",
      elapsedMs: Date.now() - startedAt,
    });
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string | string[];
}

interface TokenErrorResponse {
  error?: string;
  error_description?: string;
  message?: string;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function parseDeviceCodeResponse(value: unknown): DeviceCodeResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid device code response");
  }
  const data = value as Partial<DeviceCodeResponse>;
  if (
    !isBoundedString(data.device_code, 4096) ||
    !isBoundedString(data.user_code, 128) ||
    !isBoundedString(data.verification_uri, 2048) ||
    !Number.isInteger(data.expires_in) ||
    (data.expires_in ?? 0) < 1 ||
    (data.expires_in ?? 0) > 86_400 ||
    !Number.isInteger(data.interval) ||
    (data.interval ?? 0) < 1 ||
    (data.interval ?? 0) > 60
  ) {
    throw new Error("Invalid device code response");
  }

  let verificationUrl: URL;
  try {
    verificationUrl = new URL(data.verification_uri);
  } catch {
    throw new Error("Invalid device code response");
  }
  if (
    verificationUrl.protocol !== "https:" ||
    verificationUrl.hostname !== "www.twitch.tv" ||
    verificationUrl.port !== "" ||
    verificationUrl.username !== "" ||
    verificationUrl.password !== "" ||
    verificationUrl.pathname !== "/activate"
  ) {
    throw new Error("Invalid device code response");
  }

  return data as DeviceCodeResponse;
}

function parseTokenResponse(value: unknown): TokenResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid token response");
  }
  const data = value as Partial<TokenResponse>;
  const scopeIsValid =
    data.scope === undefined ||
    (typeof data.scope === "string" && data.scope.length <= 8192) ||
    (Array.isArray(data.scope) &&
      data.scope.length <= 128 &&
      data.scope.every((scope) => isBoundedString(scope, 256)));
  if (
    !isBoundedString(data.access_token, 4096) ||
    (data.refresh_token !== undefined && !isBoundedString(data.refresh_token, 4096)) ||
    data.token_type?.toLowerCase() !== "bearer" ||
    (data.expires_in !== undefined &&
      (!Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 604_800)) ||
    !scopeIsValid
  ) {
    throw new Error("Invalid token response");
  }
  return data as TokenResponse;
}

// ========== Constants ==========

const DEVICE_AUTH_ENDPOINT = "https://id.twitch.tv/oauth2/device";
const TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";

// ========== Device Code Flow Service ==========

class DeviceCodeFlowService {
  private pollingInterval: { stop: () => void } | null = null;
  private cancelActivePoll: (() => void) | null = null;

  /**
   * Step 1: Request a device code and user code from Twitch
   */
  async requestDeviceCode(scopes: string[]): Promise<DeviceCodeResult> {
    const config = getOAuthConfig("twitch");

    if (!config.clientId) {
      throw new Error("Twitch public client ID is not configured. Device Code Flow cannot start.");
    }

    const body = new URLSearchParams({
      client_id: config.clientId,
      scopes: scopes.join(" "),
    });

    logger.debug("Auth:DeviceCode", "Requesting device code from Twitch");

    const response = await fetch(DEVICE_AUTH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as TokenErrorResponse;
      throw new Error(error.error_description || error.message || "Failed to request device code");
    }

    const data = parseDeviceCodeResponse(await response.json());

    logger.debug("Auth:DeviceCode", "Device code received");
    logger.debug("Auth:DeviceCode", "Verification URL ready");

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  /**
   * Step 2: Poll for the access token
   * Returns a promise that resolves when the user authorizes or rejects after timeout
   */
  async pollForToken(
    deviceCode: string,
    interval: number,
    expiresIn: number,
    scopes: string[],
    onStatusChange?: DeviceCodeStatusHandler,
    signal?: AbortSignal
  ): Promise<AuthToken> {
    const config = getOAuthConfig("twitch");
    const startTime = Date.now();
    const expiryTime = startTime + expiresIn * 1000;

    this.stopPolling();

    return new Promise((resolve, reject) => {
      let settled = false;
      let pollInFlight = false;
      let cancellationRequested = false;
      let finalConfirmationStarted = false;

      const stopTimer = (): void => {
        this.pollingInterval?.stop();
        this.pollingInterval = null;
      };
      const cleanup = (): void => {
        if (this.cancelActivePoll === hardCancel) {
          stopTimer();
          this.cancelActivePoll = null;
        }
        signal?.removeEventListener("abort", handleAbort);
      };
      const settleWithError = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const settleWithToken = (token: AuthToken): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(token);
      };
      const settleAsCancelled = (): void => {
        onStatusChange?.("error", "Authorization cancelled");
        settleWithError(new Error("Authorization cancelled"));
      };
      const hardCancel = (): void => {
        settleAsCancelled();
      };

      function startFinalConfirmation(): void {
        if (settled || finalConfirmationStarted) return;
        finalConfirmationStarted = true;
        void poll(true);
      }
      const requestSoftCancel = (): void => {
        if (settled || cancellationRequested) return;
        cancellationRequested = true;
        stopTimer();
        if (!pollInFlight) startFinalConfirmation();
      };
      const handleAbort = (): void => {
        if (signal?.reason === POPUP_CLOSED_ABORT_REASON) {
          requestSoftCancel();
        } else {
          hardCancel();
        }
      };

      const poll = async (finalConfirmation = false): Promise<void> => {
        if (settled || pollInFlight) return;
        pollInFlight = true;
        let needsFinalConfirmation = false;

        // Check if expired
        if (Date.now() >= expiryTime) {
          if (cancellationRequested) {
            settleAsCancelled();
          } else {
            onStatusChange?.("expired", "Device code expired");
            settleWithError(new Error("Device code expired. Please try again."));
          }
          pollInFlight = false;
          return;
        }

        try {
          const body = new URLSearchParams({
            client_id: config.clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            scopes: scopes.join(" "),
          });

          const response = await fetch(TOKEN_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
            signal: finalConfirmation ? undefined : signal,
          });

          const data = await response.json();
          if (settled) return;

          if (response.ok) {
            // Success! User has authorized
            let tokenData: TokenResponse;
            try {
              tokenData = parseTokenResponse(data);
            } catch {
              onStatusChange?.("error", "Invalid token response");
              settleWithError(new Error("Invalid token response"));
              return;
            }

            const token: AuthToken = {
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: tokenData.expires_in
                ? Date.now() + tokenData.expires_in * 1000
                : undefined,
              scope: Array.isArray(tokenData.scope) ? tokenData.scope : tokenData.scope?.split(" "),
              authFlow: "device-code",
            };

            logger.debug("Auth:DeviceCode", "User authorized! Token obtained");
            onStatusChange?.("authorized", "Authorization successful!");
            settleWithToken(token);
            return;
          }

          if (cancellationRequested) {
            if (finalConfirmation) {
              settleAsCancelled();
            } else {
              needsFinalConfirmation = true;
            }
            return;
          }

          // Handle error responses
          const errorData = data as TokenErrorResponse;
          const errorStatus = errorData.error ?? errorData.message;

          switch (errorStatus) {
            case "authorization_pending":
              // User hasn't authorized yet - keep polling
              onStatusChange?.("pending", "Waiting for user to authorize...");
              break;
            case "slow_down":
              // We're polling too fast - increase interval
              logger.debug("Auth:DeviceCode", "Polling too fast, slowing down");
              interval += 5;
              stopTimer();
              this.pollingInterval = createManagedInterval(poll, interval * 1000);
              break;
            case "access_denied":
              // User denied the request
              onStatusChange?.("error", "Authorization denied by user");
              settleWithError(new Error("Authorization denied by user"));
              return;
            case "expired_token":
              // Device code expired
              onStatusChange?.("expired", "Device code expired");
              settleWithError(new Error("Device code expired. Please try again."));
              return;
            default:
              // Unknown error
              onStatusChange?.("error", errorData.error_description || errorStatus);
              settleWithError(
                new Error(errorData.error_description || errorStatus || "Unknown error")
              );
              return;
          }
        } catch (error) {
          if (settled) return;
          if (cancellationRequested) {
            if (finalConfirmation) {
              settleAsCancelled();
            } else {
              needsFinalConfirmation = true;
            }
            return;
          }
          if (signal?.aborted) return;
          logger.error("Auth:DeviceCode", "Polling error", {
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
          // Network error - continue polling
        } finally {
          pollInFlight = false;
          if (needsFinalConfirmation) startFinalConfirmation();
        }
      };

      this.cancelActivePoll = hardCancel;
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      signal?.addEventListener("abort", handleAbort, { once: true });

      // Start polling
      void poll();
      this.pollingInterval = createManagedInterval(poll, interval * 1000);
    });
  }

  /**
   * Stop polling for token
   */
  stopPolling(): void {
    this.cancelActivePoll?.();
    this.cancelActivePoll = null;
    this.pollingInterval?.stop();
    this.pollingInterval = null;
  }

  /**
   * Check if currently polling
   */
  isPolling(): boolean {
    return this.pollingInterval !== null;
  }
}

// ========== Export Singleton ==========

export const deviceCodeFlowService = new DeviceCodeFlowService();

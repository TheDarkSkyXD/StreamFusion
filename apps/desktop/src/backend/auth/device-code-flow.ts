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

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string | string[];
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
  message?: string;
}

// ========== Constants ==========

const DEVICE_AUTH_ENDPOINT = "https://id.twitch.tv/oauth2/device";
const TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";

// ========== Device Code Flow Service ==========

class DeviceCodeFlowService {
  private pollingInterval: { stop: () => void } | null = null;

  /**
   * Step 1: Request a device code and user code from Twitch
   */
  async requestDeviceCode(scopes: string[]): Promise<DeviceCodeResult> {
    const config = getOAuthConfig("twitch");

    if (!config.clientId) {
      throw new Error(
        "TWITCH_CLIENT_ID not set. Please configure your .env file. " +
          "See .env.example for instructions."
      );
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

    const data = (await response.json()) as DeviceCodeResponse;

    logger.debug("Auth:DeviceCode", "Device code received", { userCode: data.user_code });
    logger.debug("Auth:DeviceCode", "Verification URL ready", {
      verificationUri: data.verification_uri,
    });

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
    onStatusChange?: (
      status: "pending" | "authorized" | "expired" | "error",
      message?: string
    ) => void
  ): Promise<AuthToken> {
    const config = getOAuthConfig("twitch");
    const startTime = Date.now();
    const expiryTime = startTime + expiresIn * 1000;

    return new Promise((resolve, reject) => {
      const poll = async () => {
        // Check if expired
        if (Date.now() >= expiryTime) {
          this.stopPolling();
          onStatusChange?.("expired", "Device code expired");
          reject(new Error("Device code expired. Please try again."));
          return;
        }

        try {
          const body = new URLSearchParams({
            client_id: config.clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          });

          const response = await fetch(TOKEN_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          });

          const data = await response.json();

          if (response.ok) {
            // Success! User has authorized
            this.stopPolling();
            const tokenData = data as TokenResponse;

            const token: AuthToken = {
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: tokenData.expires_in
                ? Date.now() + tokenData.expires_in * 1000
                : undefined,
              scope: Array.isArray(tokenData.scope) ? tokenData.scope : tokenData.scope?.split(" "),
            };

            logger.debug("Auth:DeviceCode", "User authorized! Token obtained");
            onStatusChange?.("authorized", "Authorization successful!");
            resolve(token);
            return;
          }

          // Handle error responses
          const errorData = data as TokenErrorResponse;

          switch (errorData.error) {
            case "authorization_pending":
              // User hasn't authorized yet - keep polling
              onStatusChange?.("pending", "Waiting for user to authorize...");
              break;
            case "slow_down":
              // We're polling too fast - increase interval
              logger.debug("Auth:DeviceCode", "Polling too fast, slowing down");
              interval += 5;
              break;
            case "access_denied":
              // User denied the request
              this.stopPolling();
              onStatusChange?.("error", "Authorization denied by user");
              reject(new Error("Authorization denied by user"));
              return;
            case "expired_token":
              // Device code expired
              this.stopPolling();
              onStatusChange?.("expired", "Device code expired");
              reject(new Error("Device code expired. Please try again."));
              return;
            default:
              // Unknown error
              this.stopPolling();
              onStatusChange?.("error", errorData.error_description || errorData.error);
              reject(new Error(errorData.error_description || errorData.error || "Unknown error"));
              return;
          }
        } catch (error) {
          logger.error("Auth:DeviceCode", "Polling error", {
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
          // Network error - continue polling
        }
      };

      // Start polling
      poll();
      this.pollingInterval = createManagedInterval(poll, interval * 1000);
    });
  }

  /**
   * Stop polling for token
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      this.pollingInterval.stop();
      this.pollingInterval = null;
    }
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

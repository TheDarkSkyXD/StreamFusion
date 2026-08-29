import { sleep } from "@shared/utils/sleep";
import type { AuthToken } from "../../shared/auth-types";
import { storageService } from "../services/storage-service";
import { waitForWebContentsCondition } from "../services/web-contents-ready";

export const TWITCH_FOLLOW_WRITE_CLIENT_ID = "ue6666qo983tsx6so1t0vnawi233wa";

const DEVICE_ENDPOINT = "https://id.twitch.tv/oauth2/device";
const TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";
const VALIDATE_ENDPOINT = "https://id.twitch.tv/oauth2/validate";
const FOLLOW_WRITE_SCOPES = [
  "channel_read",
  "chat:read",
  "user_blocks_edit",
  "user_blocks_read",
  "user_follows_edit",
  "user_read",
] as const;

interface CredentialStorage {
  get(): AuthToken | null;
  save(token: AuthToken): void;
  clear(): void;
}

interface ActivationWindow {
  closed: Promise<void>;
  close(): void;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  scope?: string | string[];
}

interface TokenErrorResponse {
  error?: string;
  error_description?: string;
  message?: string;
}

interface ValidationResponse {
  client_id?: string;
  user_id?: string;
  scopes?: string[];
}

export interface TwitchFollowWriteCredential {
  clientId: string;
  accessToken: string;
  userId: string;
}

interface TwitchFollowWriteCredentialDependencies {
  storage?: CredentialStorage;
  fetch?: typeof fetch;
  openActivationWindow?: (
    verificationUri: string,
    userCode: string
  ) => ActivationWindow | Promise<ActivationWindow>;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

function parseScopes(scope: string | string[] | undefined): string[] {
  if (Array.isArray(scope)) return scope;
  return scope?.split(" ").filter(Boolean) ?? [];
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as TokenErrorResponse;
  return new Error(body.error_description || body.message || body.error || fallback);
}

async function openTwitchActivationWindow(
  verificationUri: string,
  userCode: string
): Promise<ActivationWindow> {
  const { BrowserWindow } = await import("electron");
  const window = new BrowserWindow({
    width: 500,
    height: 750,
    minWidth: 400,
    minHeight: 600,
    center: true,
    show: false,
    title: "Activate Twitch follows",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  window.once("ready-to-show", () => window.show());
  window.once("closed", resolveClosed);
  try {
    await window.loadURL(verificationUri);
    const encodedUserCode = JSON.stringify(userCode);
    const prefilled = await waitForWebContentsCondition(
      window.webContents,
      `(() => {
        const input = document.querySelector('input[name="user_code"], input[placeholder="Enter Code"]');
        if (!(input instanceof HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) return false;
        setter.call(input, ${encodedUserCode});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.focus();
        return input.value === ${encodedUserCode};
      })()`,
      { timeoutMs: 15_000 }
    );
    if (!prefilled) {
      if (window.isDestroyed()) throw new Error("Twitch follow authorization was cancelled");
      throw new Error("Twitch activation page did not become ready");
    }
  } catch (error) {
    if (!window.isDestroyed()) window.close();
    throw error;
  }

  return {
    closed,
    close: () => {
      if (!window.isDestroyed()) window.close();
    },
  };
}

export class TwitchFollowWriteCredentialService {
  private readonly storage: CredentialStorage;
  private readonly fetchImpl: typeof fetch;
  private readonly openActivationWindow: (
    verificationUri: string,
    userCode: string
  ) => ActivationWindow | Promise<ActivationWindow>;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private authorizationInFlight: Promise<TwitchFollowWriteCredential> | null = null;

  constructor(dependencies: TwitchFollowWriteCredentialDependencies = {}) {
    this.storage =
      dependencies.storage ??
      ({
        get: () => storageService.getTwitchFollowWriteToken(),
        save: (token) => storageService.saveTwitchFollowWriteToken(token),
        clear: () => storageService.clearTwitchFollowWriteToken(),
      } satisfies CredentialStorage);
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.openActivationWindow = dependencies.openActivationWindow ?? openTwitchActivationWindow;
    this.delay = dependencies.delay ?? sleep;
    this.now = dependencies.now ?? Date.now;
  }

  async getCredential(): Promise<TwitchFollowWriteCredential> {
    const stored = this.storage.get();
    const storedValidation = stored ? await this.validate(stored) : null;
    if (stored && storedValidation) {
      return this.asCredential(stored, storedValidation.user_id!);
    }
    if (stored) this.storage.clear();

    if (!this.authorizationInFlight) {
      this.authorizationInFlight = this.authorize().finally(() => {
        this.authorizationInFlight = null;
      });
    }
    return this.authorizationInFlight;
  }

  clearCredential(): void {
    this.storage.clear();
  }

  private asCredential(token: AuthToken, userId: string): TwitchFollowWriteCredential {
    return {
      clientId: TWITCH_FOLLOW_WRITE_CLIENT_ID,
      accessToken: token.accessToken,
      userId,
    };
  }

  private async authorize(): Promise<TwitchFollowWriteCredential> {
    const device = await this.requestDeviceCode();
    const activationWindow = await this.openActivationWindow(
      device.verification_uri,
      device.user_code
    );
    try {
      const token = await this.pollForToken(device, activationWindow.closed);
      const validation = await this.validate(token);
      if (!validation) {
        throw new Error("Twitch follow authorization returned an invalid credential");
      }
      this.storage.save(token);
      return this.asCredential(token, validation.user_id!);
    } finally {
      activationWindow.close();
    }
  }

  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const body = new URLSearchParams({
      client_id: TWITCH_FOLLOW_WRITE_CLIENT_ID,
      scopes: FOLLOW_WRITE_SCOPES.join(" "),
    });
    const response = await this.fetchImpl(DEVICE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) throw await responseError(response, "Failed to start Twitch authorization");
    return (await response.json()) as DeviceCodeResponse;
  }

  private async pollForToken(
    device: DeviceCodeResponse,
    windowClosed: Promise<void>
  ): Promise<AuthToken> {
    const expiresAt = this.now() + device.expires_in * 1000;
    let intervalSeconds = Math.max(1, device.interval ?? 1);
    let closed = false;
    void windowClosed.then(() => {
      closed = true;
    });

    while (this.now() < expiresAt) {
      if (closed) throw new Error("Twitch follow authorization was cancelled");
      const body = new URLSearchParams({
        client_id: TWITCH_FOLLOW_WRITE_CLIENT_ID,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      const response = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const data = (await response.json().catch(() => ({}))) as TokenResponse & TokenErrorResponse;

      if (closed) throw new Error("Twitch follow authorization was cancelled");
      if (response.ok && data.access_token) {
        return {
          accessToken: data.access_token,
          expiresAt: data.expires_in ? this.now() + data.expires_in * 1000 : undefined,
          scope: parseScopes(data.scope),
        };
      }

      const pollingStatus = data.error ?? data.message;
      if (pollingStatus === "slow_down") {
        intervalSeconds += 5;
      } else if (pollingStatus !== "authorization_pending") {
        throw new Error(data.error_description || pollingStatus || "Twitch authorization failed");
      }

      const delayCompleted = await Promise.race([
        this.delay(intervalSeconds * 1000).then(() => true),
        windowClosed.then(() => false),
      ]);
      if (!delayCompleted) throw new Error("Twitch follow authorization was cancelled");
    }

    throw new Error("Twitch follow authorization expired");
  }

  private async validate(token: AuthToken): Promise<ValidationResponse | null> {
    if (token.expiresAt && token.expiresAt <= this.now()) return null;
    const response = await this.fetchImpl(VALIDATE_ENDPOINT, {
      headers: { Authorization: `OAuth ${token.accessToken}` },
    });
    if (!response.ok) return null;
    const validation = (await response.json()) as ValidationResponse;
    const isValid =
      validation.client_id === TWITCH_FOLLOW_WRITE_CLIENT_ID &&
      Boolean(validation.user_id) &&
      validation.scopes?.includes("user_follows_edit") === true;
    return isValid ? validation : null;
  }
}

export const twitchFollowWriteCredentialService = new TwitchFollowWriteCredentialService();

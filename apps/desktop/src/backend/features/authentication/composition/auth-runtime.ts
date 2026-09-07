/**
 * Auth Module Index
 *
 * Exports all authentication-related services and utilities.
 */

// Auth Window Manager
export {
  type AuthSession,
  authWindowManager,
  type OpenAuthWindowOptions,
  type OpenAuthWindowResult,
} from "../adapters/electron/auth-window";
// Device Code Flow (for Twitch - no redirect URI needed)
export { type DeviceCodeResult, deviceCodeFlowService } from "../adapters/twitch/device-code-flow";
// Kick Auth Service
export { kickAuthService } from "../adapters/kick/kick-auth";
// OAuth Callback Server (localhost HTTP server for OAuth callbacks)
export {
  type CallbackServerOptions,
  type OAuthCallbackResult,
  oauthCallbackServer,
} from "../adapters/node/oauth-callback-server";
// OAuth Configuration
export {
  type AuthUrlParams,
  buildAuthorizationUrl,
  DEFAULT_CALLBACK_PORT,
  generatePkceChallenge,
  generateState,
  getOAuthConfig,
  getRedirectUri,
  KICK_OAUTH_CONFIG,
  type OAuthConfig,
  type PkceChallenge,
  PROTOCOL_PREFIX,
  PROTOCOL_SCHEME,
  TWITCH_OAUTH_CONFIG,
  validateOAuthConfig,
} from "../adapters/oauth/oauth-config";
// Protocol Handler (for custom protocol - fallback)
export { type OAuthCallback, type OAuthCallbackHandler, protocolHandler } from "../adapters/electron/protocol-handler";
// Token Exchange
export {
  type TokenExchangeParams,
  type TokenRefreshParams,
  type TokenRevokeParams,
  tokenExchangeService,
} from "../adapters/oauth/token-exchange";
// Twitch Auth Service
export { twitchAuthService } from "../adapters/twitch/twitch-auth";

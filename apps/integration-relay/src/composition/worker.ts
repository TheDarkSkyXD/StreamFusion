import {
  createRelayNotFoundResponse,
  createRelayUnavailableResponse
} from "../transport/not-found";
import {
  createInstallationPolicyRelayRoute,
  parseConfiguredManifest
} from "../features/installation-policy/composition/installation-policy-relay";
import type { RelayEnvironment } from "../features/installation-policy/capabilities/installation-registry";
import { createFollowedContentRelayRoute } from "../features/followed-content/composition/followed-content-relay";
import { createSignedOutDiscoveryRelayRoute } from "../features/signed-out-discovery/composition/signed-out-discovery-relay";

interface Env {
  CAPABILITY_MANIFEST_JSON?: string;
  INSTALLATION_REGISTRY?: D1Database;
  KICK_CLIENT_ID?: string;
  KICK_CLIENT_SECRET?: string;
  RELAY_CREDENTIAL_HMAC_SECRET?: string;
  RELAY_ENVIRONMENT: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
}

const RELAY_ENVIRONMENTS = new Set(["development", "production"]);

type RelayRoutes = {
  readonly capabilityManifest: ReturnType<
    typeof createInstallationPolicyRelayRoute
  >;
  readonly database: D1Database;
  readonly discovery: ReturnType<typeof createSignedOutDiscoveryRelayRoute>;
  readonly followedContent: ReturnType<typeof createFollowedContentRelayRoute>;
  readonly environment: RelayEnvironment;
  readonly kickClientId: string | undefined;
  readonly kickClientSecret: string | undefined;
  readonly manifest: string | undefined;
  readonly secret: string;
  readonly twitchClientId: string | undefined;
  readonly twitchClientSecret: string | undefined;
};

type ConfiguredEnv = Env & {
  readonly INSTALLATION_REGISTRY: D1Database;
  readonly RELAY_CREDENTIAL_HMAC_SECRET: string;
  readonly RELAY_ENVIRONMENT: RelayEnvironment;
};

export function isRelayEnvironment(value: string): value is RelayEnvironment {
  return RELAY_ENVIRONMENTS.has(value);
}

export function createRelayWorker(
  input: {
    readonly fetch?: typeof globalThis.fetch;
    readonly now?: () => number;
  } = {}
) {
  let routes: RelayRoutes | null = null;
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const requestId = crypto.randomUUID();
      if (!isRelayEnvironment(env.RELAY_ENVIRONMENT)) {
        return createRelayUnavailableResponse(requestId);
      }

      if (!isRelayRequest(request)) {
        return createRelayNotFoundResponse(requestId);
      }

      const configuredEnv = configuredEnvFrom(env);
      if (configuredEnv === null) {
        return createRelayUnavailableResponse(requestId);
      }

      const now = input.now ?? Date.now;
      try {
        routes = routesFor({
          cached: routes,
          env: configuredEnv,
          fetch: input.fetch ?? globalThis.fetch,
          now
        });
        const response = await routes.capabilityManifest(request, requestId);
        if (response !== null) return response;
        const discoveryResponse = await routes.discovery(request, requestId);
        if (discoveryResponse !== null) return discoveryResponse;
        const followedResponse = await routes.followedContent(
          request,
          requestId
        );
        if (followedResponse !== null) return followedResponse;
      } catch {
        return createRelayUnavailableResponse(requestId);
      }

      return createRelayNotFoundResponse(requestId);
    }
  };
}

function configuredEnvFrom(env: Env): ConfiguredEnv | null {
  if (
    env.INSTALLATION_REGISTRY === undefined ||
    env.RELAY_CREDENTIAL_HMAC_SECRET === undefined ||
    env.RELAY_CREDENTIAL_HMAC_SECRET.length < 32 ||
    !isRelayEnvironment(env.RELAY_ENVIRONMENT)
  ) {
    return null;
  }
  return {
    ...env,
    INSTALLATION_REGISTRY: env.INSTALLATION_REGISTRY,
    RELAY_CREDENTIAL_HMAC_SECRET: env.RELAY_CREDENTIAL_HMAC_SECRET,
    RELAY_ENVIRONMENT: env.RELAY_ENVIRONMENT
  };
}

function routesFor(input: {
  readonly cached: RelayRoutes | null;
  readonly env: ConfiguredEnv;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
}): RelayRoutes {
  if (sameRouteConfiguration(input.cached, input.env)) return input.cached;
  return {
    capabilityManifest: createInstallationPolicyRelayRoute({
      credentialSecret: input.env.RELAY_CREDENTIAL_HMAC_SECRET,
      database: input.env.INSTALLATION_REGISTRY,
      environment: input.env.RELAY_ENVIRONMENT,
      manifest: parseConfiguredManifest(
        input.env.CAPABILITY_MANIFEST_JSON,
        input.env.RELAY_ENVIRONMENT
      ),
      now: input.now
    }),
    database: input.env.INSTALLATION_REGISTRY,
    discovery: createSignedOutDiscoveryRelayRoute({
      credentialSecret: input.env.RELAY_CREDENTIAL_HMAC_SECRET,
      database: input.env.INSTALLATION_REGISTRY,
      environment: input.env.RELAY_ENVIRONMENT,
      fetch: input.fetch,
      kickClientId: input.env.KICK_CLIENT_ID,
      kickClientSecret: input.env.KICK_CLIENT_SECRET,
      now: input.now,
      twitchClientId: input.env.TWITCH_CLIENT_ID,
      twitchClientSecret: input.env.TWITCH_CLIENT_SECRET
    }),
    followedContent: createFollowedContentRelayRoute({
      credentialSecret: input.env.RELAY_CREDENTIAL_HMAC_SECRET,
      database: input.env.INSTALLATION_REGISTRY,
      environment: input.env.RELAY_ENVIRONMENT,
      fetch: input.fetch,
      kickClientId: input.env.KICK_CLIENT_ID,
      kickClientSecret: input.env.KICK_CLIENT_SECRET,
      now: input.now,
      twitchClientId: input.env.TWITCH_CLIENT_ID,
      twitchClientSecret: input.env.TWITCH_CLIENT_SECRET
    }),
    environment: input.env.RELAY_ENVIRONMENT,
    kickClientId: input.env.KICK_CLIENT_ID,
    kickClientSecret: input.env.KICK_CLIENT_SECRET,
    manifest: input.env.CAPABILITY_MANIFEST_JSON,
    secret: input.env.RELAY_CREDENTIAL_HMAC_SECRET,
    twitchClientId: input.env.TWITCH_CLIENT_ID,
    twitchClientSecret: input.env.TWITCH_CLIENT_SECRET
  };
}

function sameRouteConfiguration(
  cached: RelayRoutes | null,
  env: ConfiguredEnv
): cached is RelayRoutes {
  return (
    cached !== null &&
    cached.database === env.INSTALLATION_REGISTRY &&
    cached.environment === env.RELAY_ENVIRONMENT &&
    cached.kickClientId === env.KICK_CLIENT_ID &&
    cached.kickClientSecret === env.KICK_CLIENT_SECRET &&
    cached.manifest === env.CAPABILITY_MANIFEST_JSON &&
    cached.secret === env.RELAY_CREDENTIAL_HMAC_SECRET &&
    cached.twitchClientId === env.TWITCH_CLIENT_ID &&
    cached.twitchClientSecret === env.TWITCH_CLIENT_SECRET
  );
}

function isRelayRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return (
    (request.method === "POST" &&
      (path === "/v1/installations/register" ||
        path === "/v1/installations/rotate")) ||
    (request.method === "GET" &&
      (path === "/v1/capability-manifest" ||
        path === "/v1/discovery/top-streams" ||
        path === "/v1/discovery/categories" ||
        path === "/v1/discovery/search" ||
        path === "/v1/followed-content/streams" ||
        path === "/v1/followed-content/channels" ||
        path === "/v1/followed-content/videos" ||
        path === "/v1/followed-content/clips"))
  );
}

export default createRelayWorker();

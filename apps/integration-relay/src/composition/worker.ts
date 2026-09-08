import {
  createRelayNotFoundResponse,
  createRelayUnavailableResponse
} from "../transport/not-found";
import {
  createInstallationPolicyRelayRoute,
  parseConfiguredManifest
} from "../features/installation-policy/composition/installation-policy-relay";
import type { RelayEnvironment } from "../features/installation-policy/capabilities/installation-registry";

interface Env {
  CAPABILITY_MANIFEST_JSON?: string;
  INSTALLATION_REGISTRY?: D1Database;
  RELAY_CREDENTIAL_HMAC_SECRET?: string;
  RELAY_ENVIRONMENT: string;
}

const RELAY_ENVIRONMENTS = new Set(["development", "production"]);

export function isRelayEnvironment(value: string): value is RelayEnvironment {
  return RELAY_ENVIRONMENTS.has(value);
}

export function createRelayWorker(input: { readonly now?: () => number } = {}) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const requestId = crypto.randomUUID();
      if (!isRelayEnvironment(env.RELAY_ENVIRONMENT)) {
        return createRelayUnavailableResponse(requestId);
      }

      if (!isInstallationPolicyRequest(request)) {
        return createRelayNotFoundResponse(requestId);
      }

      if (
        env.INSTALLATION_REGISTRY === undefined ||
        env.RELAY_CREDENTIAL_HMAC_SECRET === undefined ||
        env.RELAY_CREDENTIAL_HMAC_SECRET.length < 32
      ) {
        return createRelayUnavailableResponse(requestId);
      }

      const now = input.now ?? Date.now;
      try {
        const route = createInstallationPolicyRelayRoute({
          credentialSecret: env.RELAY_CREDENTIAL_HMAC_SECRET,
          database: env.INSTALLATION_REGISTRY,
          environment: env.RELAY_ENVIRONMENT,
          manifest: parseConfiguredManifest(
            env.CAPABILITY_MANIFEST_JSON,
            env.RELAY_ENVIRONMENT
          ),
          now
        });
        const response = await route(request, requestId);
        if (response !== null) return response;
      } catch {
        return createRelayUnavailableResponse(requestId);
      }

      return createRelayNotFoundResponse(requestId);
    }
  };
}

function isInstallationPolicyRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return (
    (request.method === "POST" &&
      (path === "/v1/installations/register" ||
        path === "/v1/installations/rotate")) ||
    (request.method === "GET" && path === "/v1/capability-manifest")
  );
}

export default createRelayWorker();

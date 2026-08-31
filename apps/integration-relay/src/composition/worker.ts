import {
  createRelayNotFoundResponse,
  createRelayUnavailableResponse
} from "../transport/not-found";

interface Env {
  RELAY_ENVIRONMENT: string;
}

const RELAY_ENVIRONMENTS = new Set(["development", "production"]);

export function isRelayEnvironment(value: string): boolean {
  return RELAY_ENVIRONMENTS.has(value);
}

export function createRelayWorker() {
  return {
    fetch(_request: Request, env: Env): Response {
      const requestId = crypto.randomUUID();
      if (!isRelayEnvironment(env.RELAY_ENVIRONMENT)) {
        return createRelayUnavailableResponse(requestId);
      }

      return createRelayNotFoundResponse(requestId);
    }
  };
}

export default createRelayWorker();

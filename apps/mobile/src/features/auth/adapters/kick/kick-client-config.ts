import type {
  KickPublicClientConfiguration,
  KickPublicClientConfigurationResolver,
} from "../../capabilities/kick-session";
import { DEFAULT_WORKER_BASE } from "./kick-oauth-api";

export function parseKickClientConfiguration(
  value: unknown,
): KickPublicClientConfiguration {
  if (typeof value !== "string" || !value.trim() || value.length > 256)
    throw new Error("Mobile Kick account configuration is unavailable.");
  return { clientId: value.trim() };
}

export function createKickPublicClientConfigurationResolver(options: {
  readonly override?: string;
  readonly workerBaseUrl?: string;
  readonly fetcher?: typeof fetch;
}): KickPublicClientConfigurationResolver {
  const override = options.override?.trim();
  const workerBase = (options.workerBaseUrl ?? DEFAULT_WORKER_BASE).replace(
    /\/$/u,
    "",
  );
  const fetcher = options.fetcher ?? fetch;
  let cached: KickPublicClientConfiguration | undefined;
  let inFlight: Promise<KickPublicClientConfiguration> | undefined;
  return {
    resolve() {
      if (override)
        return Promise.resolve(parseKickClientConfiguration(override));
      if (cached) return Promise.resolve(cached);
      if (!inFlight) {
        inFlight = (async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          try {
            const response = await fetcher(`${workerBase}/auth/kick/config`, {
              headers: { Accept: "application/json" },
              signal: controller.signal,
            });
            if (!response.ok)
              throw new Error("Kick configuration is unavailable.");
            const body: unknown = await response.json();
            if (
              typeof body !== "object" ||
              body === null ||
              !("clientId" in body)
            )
              throw new Error("Kick configuration is invalid.");
            cached = parseKickClientConfiguration(body.clientId);
            return cached;
          } finally {
            clearTimeout(timeout);
          }
        })().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
  };
}

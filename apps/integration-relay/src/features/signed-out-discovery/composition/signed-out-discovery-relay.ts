import { createHmacInstallationCredentialAuthority } from "../../installation-policy/adapters/hmac-installation-credential-authority";
import type { RelayEnvironment } from "../../installation-policy/capabilities/installation-registry";
import { createD1InstallationRegistry } from "../../installation-policy/data/d1-installation-registry";
import { createD1RelayRateLimiter } from "../../installation-policy/data/d1-relay-rate-limiter";
import { createInstallationService } from "../../installation-policy/domain/installation-service";
import { createKickOfficialCatalog } from "../adapters/kick-official-catalog";
import { createTwitchHelixCatalog } from "../adapters/twitch-helix-catalog";
import type { AppCredentials } from "../capabilities/discovery-catalog";
import { createSignedOutDiscoveryService } from "../domain/discovery-service";
import { createSignedOutDiscoveryRoute } from "../routes/signed-out-discovery-route";

export function createSignedOutDiscoveryRelayRoute(input: {
  readonly credentialSecret: string;
  readonly database: D1Database;
  readonly environment: RelayEnvironment;
  readonly fetch: typeof globalThis.fetch;
  readonly kickClientId?: string;
  readonly kickClientSecret?: string;
  readonly now: () => number;
  readonly twitchClientId?: string;
  readonly twitchClientSecret?: string;
}) {
  const rateLimiter = createD1RelayRateLimiter(input.database);
  const installationService = createInstallationService({
    authority: createHmacInstallationCredentialAuthority({
      secret: input.credentialSecret
    }),
    environment: input.environment,
    now: input.now,
    registry: createD1InstallationRegistry(input.database)
  });
  return createSignedOutDiscoveryRoute({
    authorizer: installationService,
    now: input.now,
    rateLimiter,
    service: createSignedOutDiscoveryService({
      catalogs: [
        createTwitchHelixCatalog({
          credentials: appCredentials(
            input.twitchClientId,
            input.twitchClientSecret
          ),
          fetch: input.fetch,
          now: input.now
        }),
        createKickOfficialCatalog({
          credentials: appCredentials(input.kickClientId, input.kickClientSecret),
          fetch: input.fetch,
          now: input.now
        })
      ]
    })
  });
}

function appCredentials(
  clientId: string | undefined,
  clientSecret: string | undefined
): AppCredentials | null {
  if (
    clientId === undefined ||
    clientSecret === undefined ||
    clientId.length === 0 ||
    clientSecret.length === 0
  ) {
    return null;
  }
  return { clientId, clientSecret };
}

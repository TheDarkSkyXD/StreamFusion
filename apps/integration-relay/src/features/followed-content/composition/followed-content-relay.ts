import { createHmacInstallationCredentialAuthority } from "../../installation-policy/adapters/hmac-installation-credential-authority";
import type { RelayEnvironment } from "../../installation-policy/capabilities/installation-registry";
import { createD1InstallationRegistry } from "../../installation-policy/data/d1-installation-registry";
import { createD1RelayRateLimiter } from "../../installation-policy/data/d1-relay-rate-limiter";
import { createInstallationService } from "../../installation-policy/domain/installation-service";
import { createKickFollowedCatalog } from "../adapters/kick-followed-catalog";
import { createTwitchFollowedCatalog } from "../adapters/twitch-followed-catalog";
import type { AppCredentials } from "../../signed-out-discovery/capabilities/discovery-catalog";
import { createFollowedContentService } from "../domain/followed-content-service";
import { createFollowedContentRoute } from "../routes/followed-content-route";

export function createFollowedContentRelayRoute(input: {
  readonly credentialSecret: string;
  readonly database: D1Database;
  readonly environment: RelayEnvironment;
  readonly fetch: typeof globalThis.fetch;
  readonly kickClientId: string | undefined;
  readonly kickClientSecret: string | undefined;
  readonly now: () => number;
  readonly twitchClientId: string | undefined;
  readonly twitchClientSecret: string | undefined;
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
  return createFollowedContentRoute({
    authorizer: installationService,
    now: input.now,
    rateLimiter,
    service: createFollowedContentService({
      catalogs: [
        createTwitchFollowedCatalog({
          credentials: appCredentials(
            input.twitchClientId,
            input.twitchClientSecret
          ),
          fetch: input.fetch,
          now: input.now
        }),
        createKickFollowedCatalog({
          credentials: appCredentials(
            input.kickClientId,
            input.kickClientSecret
          ),
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

import { createHmacInstallationCredentialAuthority } from "../../installation-policy/adapters/hmac-installation-credential-authority";
import type { RelayEnvironment } from "../../installation-policy/capabilities/installation-registry";
import { createD1InstallationRegistry } from "../../installation-policy/data/d1-installation-registry";
import { createD1RelayRateLimiter } from "../../installation-policy/data/d1-relay-rate-limiter";
import { createInstallationService } from "../../installation-policy/domain/installation-service";
import { createD1NativePushRegistry } from "../data/d1-native-push-registry";
import { createNativePushService } from "../domain/native-push-service";
import { createNotificationsRoute } from "../routes/notifications-route";

export function createNotificationsRelayRoute(input: {
  readonly credentialSecret: string;
  readonly database: D1Database;
  readonly environment: RelayEnvironment;
  readonly now: () => number;
}) {
  const installationService = createInstallationService({
    authority: createHmacInstallationCredentialAuthority({
      secret: input.credentialSecret
    }),
    environment: input.environment,
    now: input.now,
    registry: createD1InstallationRegistry(input.database)
  });
  return createNotificationsRoute({
    authorizer: installationService,
    now: input.now,
    rateLimiter: createD1RelayRateLimiter(input.database),
    service: createNativePushService({
      now: input.now,
      registry: createD1NativePushRegistry(input.database)
    })
  });
}

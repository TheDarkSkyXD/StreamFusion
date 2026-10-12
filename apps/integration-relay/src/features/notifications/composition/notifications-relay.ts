import { createHmacInstallationCredentialAuthority } from "../../installation-policy/adapters/hmac-installation-credential-authority";
import type { RelayEnvironment } from "../../installation-policy/capabilities/installation-registry";
import { createD1InstallationRegistry } from "../../installation-policy/data/d1-installation-registry";
import { createD1RelayRateLimiter } from "../../installation-policy/data/d1-relay-rate-limiter";
import { createInstallationService } from "../../installation-policy/domain/installation-service";
import { createD1NativePushRegistry } from "../data/d1-native-push-registry";
import { createD1LiveNotificationState } from "../data/d1-live-notification-state";
import {
  createFcmHttpSender,
  parseFcmServiceAccount
} from "../adapters/fcm-http-sender";
import { createLiveNotificationWorkflow } from "../domain/live-notification-workflow";
import { createKickFollowedCatalog } from "../../followed-content/adapters/kick-followed-catalog";
import { createTwitchFollowedCatalog } from "../../followed-content/adapters/twitch-followed-catalog";
import { createNativePushService } from "../domain/native-push-service";
import { createNotificationsRoute } from "../routes/notifications-route";

export function createNotificationsRelayRoute(input: {
  readonly credentialSecret: string;
  readonly database: D1Database;
  readonly environment: RelayEnvironment;
  readonly now: () => number;
  readonly fcmServiceAccountJson: string | undefined;
  readonly kickClientId: string | undefined;
  readonly kickClientSecret: string | undefined;
  readonly twitchClientId: string | undefined;
  readonly twitchClientSecret: string | undefined;
}) {
  const serviceAccount = parseFcmServiceAccount(input.fcmServiceAccountJson);
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
      deliveryAvailable: serviceAccount !== null,
      providerAvailable: {
        kick: Boolean(input.kickClientId && input.kickClientSecret),
        twitch: Boolean(input.twitchClientId && input.twitchClientSecret)
      },
      now: input.now,
      registry: createD1NativePushRegistry(input.database)
    })
  });
}

export function createScheduledLiveNotifications(input: {
  readonly database: D1Database;
  readonly fcmServiceAccountJson: string | undefined;
  readonly fetch: typeof globalThis.fetch;
  readonly kickClientId: string | undefined;
  readonly kickClientSecret: string | undefined;
  readonly now: () => number;
  readonly twitchClientId: string | undefined;
  readonly twitchClientSecret: string | undefined;
}) {
  const serviceAccount = parseFcmServiceAccount(input.fcmServiceAccountJson);
  if (serviceAccount === null) return null;
  const credentials = (clientId?: string, clientSecret?: string) =>
    clientId && clientSecret ? { clientId, clientSecret } : null;
  return createLiveNotificationWorkflow({
    catalogs: [
      createTwitchFollowedCatalog({
        credentials: credentials(
          input.twitchClientId,
          input.twitchClientSecret
        ),
        fetch: input.fetch,
        now: input.now
      }),
      createKickFollowedCatalog({
        credentials: credentials(input.kickClientId, input.kickClientSecret),
        fetch: input.fetch,
        now: input.now
      })
    ],
    now: input.now,
    registry: createD1NativePushRegistry(input.database),
    sender: createFcmHttpSender({
      serviceAccount,
      fetch: input.fetch,
      now: input.now
    }),
    state: createD1LiveNotificationState(input.database)
  });
}

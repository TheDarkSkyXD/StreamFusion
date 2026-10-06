import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import { createModerationApi } from "../adapters/moderation-api";
import { createModerationController } from "../domain/moderation-controller";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";
import { createChannelToolsApi } from "../adapters/channel-tools-api";
import { createEventSubFeed } from "../adapters/eventsub-feed";
import { createModerationLogRepository } from "../data/moderation-log";
import { createProviderToolsController } from "../domain/provider-tools-controller";

export function createModerationRuntime({
  access,
  fetch,
  productSettings,
}: {
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch?: typeof globalThis.fetch;
  readonly productSettings?: ProductSettingsStore;
}) {
  const gateway = createModerationApi(fetch ? { fetch } : {});
  const log = productSettings
    ? createModerationLogRepository(productSettings)
    : undefined;
  const controller = createModerationController({
    access,
    gateway,
    ...(log ? { log } : {}),
  });
  const providerTools = createProviderToolsController({
    access,
    authorization: gateway,
    gateway: createChannelToolsApi(fetch),
    feeds: createEventSubFeed(fetch ? { fetch } : {}),
    ...(log ? { log } : {}),
  });
  const unsubscribe = controller.subscribe(() => {
    const snapshot = controller.getSnapshot();
    providerTools.bindChannel(
      snapshot.selection?.channel ?? null,
      snapshot.sessionRevision,
    );
  });
  return {
    ...controller,
    providerTools,
    dispose() {
      unsubscribe();
      providerTools.dispose();
      controller.dispose();
    },
  };
}

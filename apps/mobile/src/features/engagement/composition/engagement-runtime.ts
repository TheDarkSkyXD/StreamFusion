import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import { createEngagementApi } from "../adapters/engagement-api";
import { createEngagementController } from "../domain/engagement-controller";

export function createEngagementRuntime({
  access,
  fetch,
}: {
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch?: typeof globalThis.fetch;
}) {
  return createEngagementController({
    access,
    gateway: createEngagementApi(fetch ? { fetch } : {}),
  });
}

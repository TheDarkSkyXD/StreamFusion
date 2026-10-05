import type { AuthenticatedPlatformAccess } from "@mobile/features/auth/capabilities/platform-access";
import { createModerationApi } from "../adapters/moderation-api";
import { createModerationController } from "../domain/moderation-controller";

export function createModerationRuntime({
  access,
  fetch,
}: {
  readonly access: AuthenticatedPlatformAccess;
  readonly fetch?: typeof globalThis.fetch;
}) {
  return createModerationController({
    access,
    gateway: createModerationApi(fetch ? { fetch } : {}),
  });
}

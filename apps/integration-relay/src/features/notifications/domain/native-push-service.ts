import {
  fingerprintNativePushToken,
  type NativePushRegistrationGrant,
  type NativePushRegistrationRequest
} from "@streamfusion/core/relay";

import type { AuthenticatedInstallation } from "../../signed-out-discovery/capabilities/discovery-catalog";
import type { NativePushRegistry } from "../capabilities/native-push-registry";

export function createNativePushService(input: {
  readonly deliveryAvailable: boolean;
  readonly providerAvailable: {
    readonly twitch: boolean;
    readonly kick: boolean;
  };
  readonly now: () => number;
  readonly registry: NativePushRegistry;
}) {
  return {
    async register(command: {
      readonly installation: AuthenticatedInstallation;
      readonly request: NativePushRegistrationRequest;
    }): Promise<NativePushRegistrationGrant | null> {
      if (
        !input.deliveryAvailable ||
        (command.request.remoteDeliveryEnabled &&
          command.request.projection.pairs.some(
            (pair) => !input.providerAvailable[pair.platform]
          ))
      )
        return null;
      const existing = await input.registry.get(
        command.installation.installationId
      );
      const tokenFingerprint = await fingerprintNativePushToken(
        command.request.nativeToken
      );
      const reconciledAt = new Date(input.now()).toISOString();
      await input.registry.upsert({
        installationId: command.installation.installationId,
        nativeToken: command.request.nativeToken,
        tokenHash: tokenFingerprint,
        tokenType: "fcm",
        projection: command.request.projection,
        remoteDeliveryEnabled: command.request.remoteDeliveryEnabled,
        registeredAt: existing?.registeredAt ?? reconciledAt,
        rotatedAt: reconciledAt
      });
      return {
        registered: true,
        tokenFingerprint,
        projectionVersion: command.request.projection.version,
        topicSubscriptions: 0,
        overflowPairs: 0,
        reconciledAt
      };
    },

    async disable(installation: AuthenticatedInstallation): Promise<boolean> {
      return input.registry.disable(
        installation.installationId,
        new Date(input.now()).toISOString()
      );
    }
  };
}

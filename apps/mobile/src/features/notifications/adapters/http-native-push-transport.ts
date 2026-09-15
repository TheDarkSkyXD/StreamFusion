import {
  nativePushRegistrationGrantSchema,
  type LiveNotificationProjection,
  type NativePushRegistrationGrant,
} from "@streamfusion/core/relay";

import type { NativePushTransport } from "../capabilities/native-notifications";

type TransportInput = {
  readonly baseUrl: string;
  readonly credential: () => Promise<string | null>;
  readonly fetch: typeof fetch;
};

export function createHttpNativePushTransport(
  input: TransportInput,
): NativePushTransport {
  return {
    async disable() {
      const response = await postJson(input, "/v1/notifications/disable", {
        schemaVersion: 1,
      });
      return response?.ok === true;
    },
    async register(request: {
      readonly nativeToken: string;
      readonly projection: LiveNotificationProjection;
      readonly remoteDeliveryEnabled: boolean;
    }): Promise<NativePushRegistrationGrant | null> {
      const response = await postJson(input, "/v1/notifications/register", {
        schemaVersion: 1,
        nativeToken: request.nativeToken,
        tokenType: "fcm",
        projection: request.projection,
        remoteDeliveryEnabled: request.remoteDeliveryEnabled,
      });
      if (response === null || !response.ok) return null;
      const envelope: unknown = await response.json();
      if (
        !isRecord(envelope) ||
        !isRecord(envelope.outcome) ||
        envelope.outcome.kind !== "success"
      ) {
        return null;
      }
      return nativePushRegistrationGrantSchema.is(envelope.outcome.body)
        ? envelope.outcome.body
        : null;
    },
  };
}

export function createUnavailableNativePushTransport(): NativePushTransport {
  return {
    disable: async () => false,
    register: async () => null,
  };
}

async function postJson(
  input: TransportInput,
  path: string,
  body: unknown,
): Promise<Response | null> {
  const credential = await input.credential();
  if (credential === null) return null;
  return input.fetch(new URL(path, input.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type {
  ActivityRepository,
  MobilePersistenceRuntime,
  SecureSecretStore,
} from "@mobile/features/storage/capabilities/persistence";
import type { EncryptedDatabaseDriver } from "@mobile/features/storage/data/database-contracts";
import { cleanupMobileStoreNamespace } from "@mobile/features/storage/composition/store-runtime";

import { createDevelopmentActivityReadFailureProof } from "../adapters/development-activity-read-failure";
import {
  createDevelopmentActivityProofSessionPort,
  createDevelopmentActivityProofStoreFactory,
} from "../adapters/development-activity-proof-store";
import { createDevelopmentActivityProof as createProofWorkflow } from "../domain/development-activity-proof";

export function createDevelopmentActivityProof(options: {
  readonly createRuntime: (namespace: string) => MobilePersistenceRuntime;
  readonly databaseDriver: EncryptedDatabaseDriver;
  readonly mainRepository: ActivityRepository;
  readonly now: () => number;
  readonly randomUuid: () => string;
  readonly secretStore: SecureSecretStore;
}) {
  return createProofWorkflow({
    createReadFailure: createDevelopmentActivityReadFailureProof,
    mainRepository: options.mainRepository,
    now: options.now,
    randomUuid: options.randomUuid,
    session: createDevelopmentActivityProofSessionPort(options.secretStore),
    stores: createDevelopmentActivityProofStoreFactory({
      cleanup: (namespace) =>
        cleanupMobileStoreNamespace({
          databaseDriver: options.databaseDriver,
          namespace,
          secretStore: options.secretStore,
        }),
      createRuntime: options.createRuntime,
    }),
  });
}

import { KICK_ANDROID_REDIRECT_URI } from "@streamfusion/core/auth";
import { PLATFORMS } from "@streamfusion/core/platform";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { useEffect, useState } from "react";

import { createExpoAppLinkSource } from "@mobile/features/shell/adapters/expo-app-link-adapter";
import { createExpoAppMetadataReader } from "@mobile/features/diagnostics/adapters/expo-app-metadata-reader";
import { createAndroidCapabilityContractRuntime } from "@mobile/features/native-contracts/composition/android-capability-contract-runtime";
import { createCapabilityProfileRuntime } from "@mobile/features/capability-profile/composition/capability-profile-runtime";
import { useCapabilityProfileController } from "@mobile/features/capability-profile/components/use-capability-profile-controller";
import {
  createInstallationPolicyRuntime,
  publicProductionConfigurationFromEnvironment,
} from "@mobile/features/installation-policy/composition/installation-policy-runtime";
import { useInstallationPolicyController } from "@mobile/features/installation-policy/components/use-installation-policy-controller";
import { createDevelopmentClientController } from "@mobile/features/diagnostics/domain/development-client-controller";
import { usePersistenceController } from "@mobile/features/diagnostics/components/persistence-controller";
import { AppShell } from "@mobile/features/shell/components/app-shell";
import { createExpoSecureRandomSource } from "@mobile/features/storage/adapters/expo-secure-random-source";
import { createExpoSecureSecretStore } from "@mobile/features/storage/adapters/expo-secure-secret-store";
import { createSqliteEncryptedDatabaseDriver } from "@mobile/features/storage/adapters/sqlite-encrypted-driver";
import { createMobileStoreRuntime } from "@mobile/features/storage/composition/store-runtime";
import { createDevelopmentActivityProof } from "@mobile/features/activity/composition/development-activity-proof";
import { createVolatilePersistenceProbe } from "@mobile/features/diagnostics/adapters/volatile-persistence-probe";
import { createFetchRuntimeProbe } from "@mobile/features/diagnostics/adapters/fetch-runtime-probe";
import { createSecureKickCredentialRepository } from "@mobile/features/auth/data/secure-kick-credential-repository";
import { createSecureTwitchCredentialRepository } from "@mobile/features/auth/data/secure-twitch-credential-repository";
import { createKickOAuthApi } from "@mobile/features/auth/adapters/kick/kick-oauth-api";
import { createKickPkceAuthorization } from "@mobile/features/auth/adapters/kick/kick-authorization-url";
import { createKickLinkingCallbackSource } from "@mobile/features/auth/adapters/kick/kick-callback-source";
import { parseKickClientConfiguration } from "@mobile/features/auth/adapters/kick/kick-client-config";
import { createTwitchDeviceAuthApi } from "@mobile/features/auth/adapters/twitch/twitch-device-auth-api";
import { parseTwitchClientConfiguration } from "@mobile/features/auth/adapters/twitch/twitch-client-config";
import { useKickAccountController } from "@mobile/features/auth/components/use-kick-account-controller";
import { useTwitchAccountController } from "@mobile/features/auth/components/use-twitch-account-controller";
import { createKickAccountSessionController } from "@mobile/features/auth/domain/kick-account-session-controller";
import { createTwitchAccountSessionController } from "@mobile/features/auth/domain/twitch-account-session-controller";
import {
  createDevelopmentKickAuthFixture,
  DEVELOPMENT_KICK_CLIENT_ID,
} from "@mobile/features/auth/adapters/kick/development-kick-auth-fixture";
import {
  createDevelopmentTwitchAuthFixture,
  DEVELOPMENT_TWITCH_CLIENT_ID,
} from "@mobile/features/auth/adapters/twitch/development-twitch-auth-fixture";

const androidCapabilityRuntime = createAndroidCapabilityContractRuntime();

const developmentClientController = createDevelopmentClientController({
  appMetadata: createExpoAppMetadataReader(),
  nativeCapabilityContracts: Object.values(androidCapabilityRuntime.contracts),
  runtimeProbes: [createFetchRuntimeProbe(), createVolatilePersistenceProbe()],
  supportedPlatforms: PLATFORMS,
});

const secureRandom = createExpoSecureRandomSource();
const secureSecretStore = createExpoSecureSecretStore();
const databaseDriver = createSqliteEncryptedDatabaseDriver();

const persistenceRuntime = createMobileStoreRuntime({
  backupExcluded: true,
  databaseDriver,
  random: secureRandom,
  secretStore: secureSecretStore,
});

const developmentActivityProof = __DEV__
  ? createDevelopmentActivityProof({
      createRuntime: (namespace) =>
        createMobileStoreRuntime({
          backupExcluded: true,
          databaseDriver,
          namespace,
          random: secureRandom,
          secretStore: secureSecretStore,
        }),
      databaseDriver,
      mainRepository: persistenceRuntime.productState.activity,
      now: Date.now,
      randomUuid: secureRandom.uuid,
      secretStore: secureSecretStore,
    })
  : null;

const appLinks = createExpoAppLinkSource();

const capabilityProfileRuntime = createCapabilityProfileRuntime({
  diagnostics: androidCapabilityRuntime.contracts.diagnostics,
  store: persistenceRuntime.productState.capabilityProfile,
});

const installationPolicyRuntime = createInstallationPolicyRuntime({
  productionConfiguration: publicProductionConfigurationFromEnvironment({
    relayUrl: process.env.EXPO_PUBLIC_STREAMFUSION_RELAY_URL,
    trustedKeysJson: process.env.EXPO_PUBLIC_STREAMFUSION_POLICY_TRUSTED_KEYS,
  }),
  random: secureRandom,
  secretStore: secureSecretStore,
  identityPresenceStore:
    persistenceRuntime.productState.installationIdentityPresence,
  snapshotStore: persistenceRuntime.productState.installationPolicy,
});

const productionTwitchRepository = createSecureTwitchCredentialRepository({
  secrets: secureSecretStore,
});
const developmentTwitchRepository = createSecureTwitchCredentialRepository({
  secrets: secureSecretStore,
  key: "streamfusion.development.issue145.twitch-auth.v1",
});
let twitchClientId: string | null = null;
try {
  twitchClientId = parseTwitchClientConfiguration(
    process.env.EXPO_PUBLIC_TWITCH_CLIENT_ID,
  ).clientId;
} catch {
  twitchClientId = null;
}
const productionTwitchGateway = twitchClientId
  ? createTwitchDeviceAuthApi({ clientId: twitchClientId })
  : null;
const developmentTwitchGateway = __DEV__
  ? createDevelopmentTwitchAuthFixture()
  : null;
const productionTwitchController = createTwitchAccountSessionController({
  clientId: twitchClientId,
  copy: async (value) => void (await Clipboard.setStringAsync(value)),
  gateway: productionTwitchGateway,
  open: async (value) => void (await Linking.openURL(value)),
  repository: productionTwitchRepository,
});
const developmentTwitchController = createTwitchAccountSessionController({
  clientId: DEVELOPMENT_TWITCH_CLIENT_ID,
  copy: async (value) => void (await Clipboard.setStringAsync(value)),
  gateway: developmentTwitchGateway,
  open: async (value) => void (await Linking.openURL(value)),
  repository: developmentTwitchRepository,
});

const productionKickRepository = createSecureKickCredentialRepository({
  secrets: secureSecretStore,
});
const developmentKickRepository = createSecureKickCredentialRepository({
  secrets: secureSecretStore,
  key: "streamfusion.development.issue146.kick-auth.v1",
});
let kickClientId: string | null = null;
try {
  kickClientId = parseKickClientConfiguration(
    process.env.EXPO_PUBLIC_KICK_CLIENT_ID,
  ).clientId;
} catch {
  kickClientId = null;
}
const productionKickGateway = kickClientId
  ? createKickOAuthApi({
      ...(process.env.EXPO_PUBLIC_STREAMFUSION_WORKER_URL
        ? { workerBaseUrl: process.env.EXPO_PUBLIC_STREAMFUSION_WORKER_URL }
        : {}),
    })
  : null;
const developmentKickFixture = __DEV__
  ? createDevelopmentKickAuthFixture()
  : null;
const kickCallbacks = createKickLinkingCallbackSource();
const productionKickController = createKickAccountSessionController({
  authorize: createKickPkceAuthorization,
  callbacks: kickCallbacks,
  clientId: kickClientId,
  gateway: productionKickGateway,
  open: async (value) => void (await Linking.openURL(value)),
  repository: productionKickRepository,
});
const developmentKickController = createKickAccountSessionController({
  authorize: async ({ nowEpochMs }) => ({
    authorizeUrl: "https://id.kick.com/oauth/authorize?fixture=1",
    codeVerifier: "a".repeat(43),
    expiresAtEpochMs: nowEpochMs + 600_000,
    redirectUri: KICK_ANDROID_REDIRECT_URI,
    state: `development-kick-state-${nowEpochMs}`,
  }),
  callbacks: { subscribe: () => () => undefined },
  clientId: DEVELOPMENT_KICK_CLIENT_ID,
  ...(developmentKickFixture ? { fixture: developmentKickFixture } : {}),
  gateway: developmentKickFixture,
  open: async () => undefined,
  repository: developmentKickRepository,
});

export function MobileRuntime() {
  const [activityProof, setActivityProof] = useState(
    () => developmentActivityProof?.snapshot() ?? null,
  );
  const [useDevelopmentTwitchFixture, setUseDevelopmentTwitchFixture] =
    useState(false);
  const [useDevelopmentKickFixture, setUseDevelopmentKickFixture] =
    useState(false);
  const persistence = usePersistenceController(persistenceRuntime);
  const capabilityProfile = useCapabilityProfileController(
    capabilityProfileRuntime,
  );
  const installationPolicy = useInstallationPolicyController(
    installationPolicyRuntime,
  );
  const twitchAccount = useTwitchAccountController({
    controller: productionTwitchController,
  });
  const developmentTwitchAccount = useTwitchAccountController({
    controller: developmentTwitchController,
    enabled: useDevelopmentTwitchFixture,
  });
  const visibleTwitchAccount = useDevelopmentTwitchFixture
    ? developmentTwitchAccount
    : twitchAccount;
  const kickAccount = useKickAccountController({
    controller: productionKickController,
  });
  const developmentKickAccount = useKickAccountController({
    controller: developmentKickController,
    enabled: useDevelopmentKickFixture,
  });
  const visibleKickAccount = useDevelopmentKickFixture
    ? developmentKickAccount
    : kickAccount;
  useEffect(() => {
    if (!developmentActivityProof) return;
    const unsubscribe = developmentActivityProof.subscribe(setActivityProof);
    void developmentActivityProof.recover();
    return unsubscribe;
  }, []);
  return (
    <AppShell
      activityRepository={
        developmentActivityProof?.repository ??
        persistenceRuntime.productState.activity
      }
      developmentActivityProof={activityProof}
      appLinks={appLinks}
      capabilityProfile={capabilityProfile.model}
      onRetryCapabilityProfile={capabilityProfile.retry}
      installationPolicy={installationPolicy.model}
      onRefreshCapabilityPolicy={installationPolicy.refreshCapabilityPolicy}
      onRetryInstallationRegistration={
        installationPolicy.retryInstallationRegistration
      }
      onRunCapabilityProfileDevelopmentProof={() =>
        capabilityProfileRuntime.developmentProof.queueNextNativeReadFailure()
      }
      onQueueActivityReadFailure={() => {
        developmentActivityProof?.queueNextReadFailure();
      }}
      onExitDevelopmentActivityProof={async () => {
        await developmentActivityProof?.exit();
        setActivityProof(developmentActivityProof?.snapshot() ?? null);
      }}
      onReplayDevelopmentActivityProof={async () => {
        await developmentActivityProof?.replayCompleted();
        setActivityProof(developmentActivityProof?.snapshot() ?? null);
      }}
      onRetryDevelopmentActivityProofCleanup={async () => {
        await developmentActivityProof?.retryCleanup();
        setActivityProof(developmentActivityProof?.snapshot() ?? null);
      }}
      onStartDevelopmentActivityProof={async () => {
        await developmentActivityProof?.start();
        setActivityProof(developmentActivityProof?.snapshot() ?? null);
      }}
      developmentStatus={developmentClientController.read()}
      onRunNativeCapabilityProof={androidCapabilityRuntime.runStubProof}
      onPrepareRestorationProof={async (kind) => {
        await persistenceRuntime.productState.shellRestoration.write(
          kind === "corrupt" ? "not-json" : JSON.stringify({ version: 2 }),
          Date.now(),
        );
      }}
      onRunPersistenceProof={persistence.runProof}
      persistenceStatus={persistence.model}
      shellRestoration={persistenceRuntime.productState.shellRestoration}
      twitchAccount={visibleTwitchAccount.model}
      twitchAccountActions={visibleTwitchAccount.actions}
      twitchAccountDevelopmentFixture={useDevelopmentTwitchFixture}
      onEnableTwitchDevelopmentFixture={
        __DEV__ && twitchClientId === null
          ? () => setUseDevelopmentTwitchFixture(true)
          : undefined
      }
      onDisableTwitchDevelopmentFixture={
        useDevelopmentTwitchFixture
          ? () => setUseDevelopmentTwitchFixture(false)
          : undefined
      }
      kickAccount={visibleKickAccount.model}
      kickAccountActions={visibleKickAccount.actions}
      kickAccountDevelopmentFixture={useDevelopmentKickFixture}
      onEnableKickDevelopmentFixture={
        __DEV__ && kickClientId === null
          ? () => setUseDevelopmentKickFixture(true)
          : undefined
      }
      onDisableKickDevelopmentFixture={
        useDevelopmentKickFixture
          ? () => setUseDevelopmentKickFixture(false)
          : undefined
      }
    />
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  createInstallationPolicyRuntimeController,
  initialInstallationPolicyViewModel,
} from "../domain/installation-policy-runtime-controller";
import type {
  CapabilityPolicyVerifier,
  InstallationCredentialStore,
  InstallationIdentityPresenceStore,
  InstallationIdentitySource,
  InstallationPolicyEnvironment,
  InstallationPolicyTransport,
  VerifiedPolicyStore,
} from "../capabilities/installation-policy";

export function useInstallationPolicyController(runtime: {
  readonly environment: InstallationPolicyEnvironment;
  readonly identitySource: InstallationIdentitySource;
  readonly identityStore: InstallationCredentialStore;
  readonly identityPresenceStore: InstallationIdentityPresenceStore;
  readonly policyStore: VerifiedPolicyStore;
  readonly transport: InstallationPolicyTransport;
  readonly verifier: CapabilityPolicyVerifier;
}) {
  const [model, setModel] = useState(() =>
    initialInstallationPolicyViewModel(runtime.environment),
  );
  const retryRef = useRef<() => void>(() => undefined);
  const refreshRef = useRef<() => void>(() => undefined);
  const retryInstallationRegistration = useCallback(
    () => retryRef.current(),
    [],
  );
  const refreshCapabilityPolicy = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    const controller = createInstallationPolicyRuntimeController({
      ...runtime,
      cancel: clearTimeout,
      isForeground: () => AppState.currentState === "active",
      nowEpochMs: Date.now,
      schedule: setTimeout,
    });
    const unsubscribe = controller.subscribe(setModel);
    retryRef.current = controller.retryInstallationRegistration;
    refreshRef.current = controller.refreshCapabilityPolicy;
    controller.start();
    const foregroundSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") controller.onForeground();
      },
    );
    return () => {
      foregroundSubscription.remove();
      unsubscribe();
      controller.dispose();
      retryRef.current = () => undefined;
      refreshRef.current = () => undefined;
    };
  }, [runtime]);
  return { model, refreshCapabilityPolicy, retryInstallationRegistration };
}

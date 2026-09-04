import { useCallback, useEffect, useState } from "react";

import type {
  MobilePersistenceRuntime,
  PersistenceProofResult,
  PersistenceRuntimeState,
} from "@mobile/capabilities/persistence";

export interface PersistenceViewModel {
  readonly canRunProof: boolean;
  readonly detail: string;
  readonly proofDetail: string | null;
  readonly proofRunning: boolean;
  readonly title: string;
}

export function persistenceViewModel(
  state: PersistenceRuntimeState,
  proof: PersistenceProofResult | null,
  proofRunning: boolean,
  proofFailed = false,
): PersistenceViewModel {
  if (state.kind === "initializing") {
    return {
      canRunProof: false,
      detail: "Opening the encrypted Product and Cache Stores.",
      proofDetail: null,
      proofRunning,
      title: "Encrypted storage is starting",
    };
  }
  if (state.kind === "ready") {
    const proofPassed =
      proof !== null && Object.values(proof).every((result) => result);
    return {
      canRunProof: true,
      detail: `${state.cipherVersion}. Product schema ${state.productSchemaVersion}. Cache schema ${state.cacheSchemaVersion}.`,
      proofDetail: proofFailed
        ? "The isolated native storage proof could not complete. Temporary proof data was removed."
        : proof
          ? proofPassed
            ? "8/8 native storage checks passed."
            : "A native storage check failed."
          : null,
      proofRunning,
      title: state.recoveredProductStore
        ? "Encrypted storage recovered from backup"
        : "Encrypted storage is ready",
    };
  }
  return {
    canRunProof: false,
    detail: state.message,
    proofDetail:
      state.kind === "recovery-required"
        ? `Recovery artifact: ${state.artifact}`
        : null,
    proofRunning,
    title:
      state.kind === "recovery-required"
        ? "Product Store recovery is required"
        : "Encrypted storage is unavailable",
  };
}

export function usePersistenceController(runtime: MobilePersistenceRuntime): {
  readonly model: PersistenceViewModel;
  readonly runProof: () => Promise<void>;
} {
  const [state, setState] = useState<PersistenceRuntimeState>({
    kind: "initializing",
  });
  const [proof, setProof] = useState<PersistenceProofResult | null>(null);
  const [proofFailed, setProofFailed] = useState(false);
  const [proofRunning, setProofRunning] = useState(false);

  useEffect(() => {
    let active = true;
    void runtime
      .initialize()
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch(() => {
        if (active)
          setState({
            kind: "unavailable",
            reason: "product-store-unrecoverable",
            message:
              "Encrypted storage could not start. No Product data was changed.",
          });
      });
    return () => {
      active = false;
    };
  }, [runtime]);

  const runProof = useCallback(async () => {
    if (proofRunning) return;
    setProof(null);
    setProofFailed(false);
    setProofRunning(true);
    try {
      setProof(await runtime.runProof());
    } catch {
      setProofFailed(true);
    } finally {
      setProofRunning(false);
    }
  }, [proofRunning, runtime]);

  return {
    model: persistenceViewModel(state, proof, proofRunning, proofFailed),
    runProof,
  };
}

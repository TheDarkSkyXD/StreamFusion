import { useEffect, useRef } from "react";

import { useNetworkStatus } from "@/features/settings/data/useNetworkStatus";

export function usePlayerNetworkRecovery(hasError: boolean, recover: () => void): void {
  const { recoveryCount } = useNetworkStatus();
  const handledRecoveryCountRef = useRef(recoveryCount);

  useEffect(() => {
    if (recoveryCount <= handledRecoveryCountRef.current) return;
    handledRecoveryCountRef.current = recoveryCount;
    if (hasError) recover();
  }, [hasError, recover, recoveryCount]);
}

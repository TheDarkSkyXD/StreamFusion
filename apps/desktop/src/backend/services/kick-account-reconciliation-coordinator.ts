let activeReconciliations = 0;

export function beginKickAccountReconciliation(): () => void {
  activeReconciliations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeReconciliations = Math.max(0, activeReconciliations - 1);
  };
}

export function isKickAccountReconciliationActive(): boolean {
  return activeReconciliations > 0;
}

export type HardwareBackDecision =
  | "cancel-dismissal"
  | "navigate-back"
  | "leave-task";

export function resolveHardwareBack(input: {
  readonly canNavigateBack: boolean;
  readonly hasOverlay: boolean;
}): HardwareBackDecision {
  if (input.hasOverlay) return "cancel-dismissal";
  if (input.canNavigateBack) return "navigate-back";
  return "leave-task";
}

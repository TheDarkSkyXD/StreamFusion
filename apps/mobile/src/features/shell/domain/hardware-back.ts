export type HardwareBackDecision =
  | "exit-fullscreen"
  | "cancel-dismissal"
  | "navigate-back"
  | "leave-task";

export function resolveHardwareBack(input: {
  readonly canNavigateBack: boolean;
  readonly fullscreen: boolean;
  readonly hasOverlay: boolean;
  readonly watchingStream: boolean;
}): HardwareBackDecision {
  if (input.fullscreen) return "exit-fullscreen";
  if (input.hasOverlay) return "cancel-dismissal";
  if (input.canNavigateBack || input.watchingStream) return "navigate-back";
  return "leave-task";
}

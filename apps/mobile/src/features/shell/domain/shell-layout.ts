export function shouldShowBottomNavigation(input: {
  readonly height: number;
  readonly width: number;
  readonly placement: "bottom" | "rail";
  readonly playerOnlySurface: boolean;
  readonly keyboardOpen: boolean;
}): boolean {
  return (
    input.placement === "bottom" &&
    input.height >= input.width &&
    !input.playerOnlySurface &&
    !input.keyboardOpen
  );
}

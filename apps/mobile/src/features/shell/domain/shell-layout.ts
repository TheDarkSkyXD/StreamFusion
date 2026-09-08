export type CompactNavigationLayout = "row" | "grid-3" | "grid-2";

export interface CompactNavigationTextMeasurement {
  readonly layout: CompactNavigationLayout;
  readonly lineCount: number;
}

export function applyCompactNavigationTextMeasurement(
  layout: CompactNavigationLayout,
  measurement: CompactNavigationTextMeasurement,
): CompactNavigationLayout {
  if (measurement.layout !== layout || measurement.lineCount <= 1)
    return layout;

  switch (layout) {
    case "row":
      return "grid-3";
    case "grid-3":
      return "grid-2";
    case "grid-2":
      return layout;
  }
}

import { useEffect } from "react";
import { startRendererActivityReporter } from "../../composition/diagnostics/renderer-activity-reporter";

export function useRendererActivityReporter(): void {
  useEffect(startRendererActivityReporter, []);
}

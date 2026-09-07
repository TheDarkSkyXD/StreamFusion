import { getActiveIntervalCount } from "@/components/dev/interval-tracker";
import { getRenderCounts } from "@/components/dev/use-render-count";
import { getChatStoreDiagnosticCounters } from "@/features/chat/components/state/chat-store";
import { startRendererDiagnosticsReporter as startReporter } from "../../adapters/browser/renderer-diagnostics-reporter";
import { getDiagnosticsClient } from "../settings-services";

export function startRendererDiagnosticsReporter(): () => void {
  return startReporter(getDiagnosticsClient(), {
    chatCalls: getChatStoreDiagnosticCounters,
    renderCounts: getRenderCounts,
    intervalCount: getActiveIntervalCount,
  });
}

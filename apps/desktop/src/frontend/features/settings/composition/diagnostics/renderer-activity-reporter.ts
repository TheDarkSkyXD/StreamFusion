import { getChatStoreDiagnosticCounters } from "@/features/chat/components/state/chat-store";
import { startRendererActivityReporter as startReporter } from "../../adapters/browser/renderer-activity-reporter";
import { getDiagnosticsClient } from "../settings-services";

export function startRendererActivityReporter(): () => void {
  return startReporter(getDiagnosticsClient(), getChatStoreDiagnosticCounters);
}

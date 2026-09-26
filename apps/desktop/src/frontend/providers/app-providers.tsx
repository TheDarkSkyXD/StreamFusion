import { lazy, Suspense, type ReactNode } from "react";
import type { NavigateFn } from "@tanstack/react-router";
import { AuthProvider } from "@/features/auth/components/auth/AuthProvider";
import { RecoveryBoundary } from "@/features/shell/components/recovery/RecoveryBoundary";
import { ToastRoot } from "@/features/shell/components/ToastRoot";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppShutdown } from "@/features/shell/components/hooks/use-app-shutdown";
import { useLiveNotificationBridge } from "@/features/auth/components/hooks/use-live-notification-bridge";
import { QueryProvider } from "@/providers/query-provider";
import { useDownloadDuplicateConfirmationStore } from "@/features/media-library/components/state/download-duplicate-confirmation-store";
import { DisplayLanguageSync } from "@/i18n/DisplayLanguageSync";
import { useRendererActivityReporter } from "@/features/settings/components/hooks/use-renderer-activity-reporter";

const DeveloperConsole = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/dev/DeveloperConsole").then((module) => ({
        default: module.DeveloperConsole,
      }))
    )
  : null;

const DownloadDuplicateConfirmationDialog = lazy(() =>
  import("@/features/media-library/components/download-duplicate-confirmation-dialog").then(
    (module) => ({
      default: module.DownloadDuplicateConfirmationDialog,
    })
  )
);

export function AppProviders({
  children,
  navigate,
}: {
  children: ReactNode;
  navigate: NavigateFn;
}) {
  useAppShutdown();
  useLiveNotificationBridge(navigate);
  useRendererActivityReporter();

  return (
    <RecoveryBoundary name="StreamFusion" level="app">
      <QueryProvider>
        <TooltipProvider>
          <AuthProvider>
            <DisplayLanguageSync>
              {children}
              <DeferredDownloadDuplicateConfirmationDialog />
              {DeveloperConsole && (
                <Suspense fallback={null}>
                  <DeveloperConsole />
                </Suspense>
              )}
              <ToastRoot />
            </DisplayLanguageSync>
          </AuthProvider>
        </TooltipProvider>
      </QueryProvider>
    </RecoveryBoundary>
  );
}

function DeferredDownloadDuplicateConfirmationDialog() {
  const hasPendingConfirmation = useDownloadDuplicateConfirmationStore(
    (state) => state.pending !== null
  );

  if (!hasPendingConfirmation) return null;

  return (
    <Suspense fallback={null}>
      <DownloadDuplicateConfirmationDialog />
    </Suspense>
  );
}

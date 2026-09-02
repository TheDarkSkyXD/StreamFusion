import { lazy, Suspense } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/features/auth/components/auth/AuthProvider";
import { RecoveryBoundary } from "@/features/shell/components/recovery/RecoveryBoundary";
import { ToastRoot } from "@/features/shell/components/ToastRoot";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppShutdown } from "@/features/shell/data/use-app-shutdown";
import { useLiveNotificationBridge } from "@/features/auth/data/use-live-notification-bridge";
import { QueryProvider } from "@/providers/query-provider";
import { router } from "@/routes/router";
import { useDownloadDuplicateConfirmationStore } from "@/store/download-duplicate-confirmation-store";
import { DisplayLanguageSync } from "@/i18n/DisplayLanguageSync";

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

function App() {
  // Emote providers are registered lazily on first ChatPanel mount via
  // ensureEmoteProvidersInitialized() — Home/Categories don't pay the cost.

  // Wire fast renderer teardown on `app:before-quit` so the close path doesn't
  // wait on graceful chat-socket teardowns.
  useAppShutdown();
  useLiveNotificationBridge();

  return (
    <RecoveryBoundary name="StreamFusion" level="app">
      <QueryProvider>
        <TooltipProvider>
          <AuthProvider>
            <DisplayLanguageSync>
              <RouterProvider router={router} />
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

export default App;

import { lazy, Suspense } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { RecoveryBoundary } from "@/components/recovery/RecoveryBoundary";
import { ToastRoot } from "@/components/ToastRoot";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppShutdown } from "@/hooks/use-app-shutdown";
import { useLiveNotificationBridge } from "@/hooks/use-live-notification-bridge";
import { QueryProvider } from "@/providers/query-provider";
import { router } from "@/routes/router";
import { useDownloadDuplicateConfirmationStore } from "@/store/download-duplicate-confirmation-store";

const DeveloperConsole = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/dev/DeveloperConsole").then((module) => ({
        default: module.DeveloperConsole,
      }))
    )
  : null;

const DownloadDuplicateConfirmationDialog = lazy(() =>
  import("@/components/download-duplicate-confirmation-dialog").then((module) => ({
    default: module.DownloadDuplicateConfirmationDialog,
  }))
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
            <RouterProvider router={router} />
            <DeferredDownloadDuplicateConfirmationDialog />
            {DeveloperConsole && (
              <Suspense fallback={null}>
                <DeveloperConsole />
              </Suspense>
            )}
            <ToastRoot />
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

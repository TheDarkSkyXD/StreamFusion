import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { DebugPanel } from "@/components/dev/DebugPanel";
import { DownloadDuplicateConfirmationDialog } from "@/components/download-duplicate-confirmation-dialog";
import { ToastRoot } from "@/components/ToastRoot";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppShutdown } from "@/hooks/use-app-shutdown";
import { useLiveNotificationBridge } from "@/hooks/use-live-notification-bridge";
import { QueryProvider } from "@/providers/query-provider";
import { router } from "@/routes/router";

function App() {
  // Emote providers are registered lazily on first ChatPanel mount via
  // ensureEmoteProvidersInitialized() — Home/Categories don't pay the cost.

  // Wire fast renderer teardown on `app:before-quit` so the close path doesn't
  // wait on graceful chat-socket teardowns.
  useAppShutdown();
  useLiveNotificationBridge();

  return (
    <QueryProvider>
      <TooltipProvider>
        <AuthProvider>
          <RouterProvider router={router} />
          <DownloadDuplicateConfirmationDialog />
          <DebugPanel />
          <ToastRoot />
        </AuthProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}

export default App;

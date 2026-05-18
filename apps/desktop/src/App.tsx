import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { DebugPanel } from "@/components/dev/DebugPanel";
import { ToastRoot } from "@/components/ToastRoot";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppShutdown } from "@/hooks/use-app-shutdown";
import { QueryProvider } from "@/providers/query-provider";
import { router } from "@/routes/router";

function App() {
  // Emote providers are registered lazily on first ChatPanel mount via
  // ensureEmoteProvidersInitialized() — Home/Categories don't pay the cost.

  // Wire fast renderer teardown on `app:before-quit` so the close path doesn't
  // wait on graceful chat-socket teardowns.
  useAppShutdown();

  return (
    <QueryProvider>
      <TooltipProvider>
        <AuthProvider
          fallback={
            <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
              Loading StreamFusion...
            </div>
          }
        >
          <RouterProvider router={router} />
          <DebugPanel />
          <ToastRoot />
        </AuthProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}

export default App;

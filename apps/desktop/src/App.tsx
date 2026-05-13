import { RouterProvider } from "@tanstack/react-router";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/providers/query-provider";
import { router } from "@/routes/router";

function App() {
  // Emote providers are registered lazily on first ChatPanel mount via
  // ensureEmoteProvidersInitialized() — Home/Categories don't pay the cost.

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
        </AuthProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}

export default App;

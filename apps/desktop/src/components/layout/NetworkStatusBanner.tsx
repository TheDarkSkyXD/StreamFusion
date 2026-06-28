import { WifiOff } from "lucide-react";

interface NetworkStatusBannerProps {
  isOnline: boolean;
}

export function NetworkStatusBanner({ isOnline }: NetworkStatusBannerProps) {
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2.5 bg-zinc-900 px-4 py-3 text-center text-sm font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/30"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>No internet connection. StreamFusion will reconnect when you're back online.</span>
    </div>
  );
}

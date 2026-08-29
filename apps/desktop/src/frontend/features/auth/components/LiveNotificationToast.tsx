import { PlatformAvatar } from "@/components/ui/platform-avatar";
import type { LiveNotificationPayload } from "@shared/auth-types";

interface LiveNotificationToastProps {
  notification: LiveNotificationPayload;
}

export function LiveNotificationToast({ notification }: LiveNotificationToastProps) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <PlatformAvatar
        src={notification.channelAvatar}
        alt={notification.channelDisplayName}
        platform={notification.platform}
        size="h-10 w-10"
        isLive
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold leading-5 text-white">
          {notification.channelDisplayName} is live
        </div>
        <div className="whitespace-normal break-words text-xs font-medium leading-5 text-[#b2b2b2]">
          {notification.title}
        </div>
      </div>
    </div>
  );
}

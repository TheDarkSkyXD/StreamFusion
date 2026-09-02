import { useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { LuBell, LuCheckCheck, LuX } from "react-icons/lu";

import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { useNotificationStore } from "@/store/notification-store";

function formatRelativeTime(timestamp: number, t: TFunction): string {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);

  if (elapsedMinutes < 1) return t("shell.topNav.justNow");
  if (elapsedMinutes < 60) return t("shell.topNav.minutesAgo", { count: elapsedMinutes });

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t("shell.topNav.hoursAgo", { count: elapsedHours });

  const elapsedDays = Math.floor(elapsedHours / 24);
  return t("shell.topNav.daysAgo", { count: elapsedDays });
}

export function NotificationsDropdown() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const notifications = useNotificationStore((state) => state.notifications);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const dismissNotification = useNotificationStore((state) => state.dismissNotification);
  const clearNotifications = useNotificationStore((state) => state.clearNotifications);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const openNotification = React.useCallback(
    (notification: (typeof notifications)[number]) => {
      setIsOpen(false);
      void navigate({
        to: "/stream/$platform/$channel",
        params: {
          platform: notification.platform,
          channel: notification.channelName,
        },
      });
    },
    [navigate]
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-[var(--color-background-secondary)] transition-colors outline-none"
        title={t("shell.topNav.notifications")}
      >
        <LuBell size={24} strokeWidth={3} className="text-white" />
        {unreadCount > 0 && (
          <span className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-700 text-sm font-bold text-white ring-2 ring-[var(--color-background)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-elevated)] shadow-xl p-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-3 py-2 border-b border-[var(--color-border)] mb-1 flex items-center justify-between gap-2 bg-[var(--color-background-elevated)] sticky top-0 z-10">
            <span className="text-sm font-semibold text-white">
              {t("shell.topNav.notifications")}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-[var(--color-foreground-secondary)] transition-colors hover:bg-[var(--color-background-tertiary)] hover:text-white"
                onClick={markAllRead}
              >
                <LuCheckCheck size={14} />
                {t("shell.topNav.markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 flex flex-col items-center justify-center text-center">
                <LuBell
                  size={32}
                  className="text-[var(--color-foreground-muted)] mb-2 opacity-50"
                />
                <p className="text-sm text-[var(--color-foreground-secondary)]">
                  {t("shell.topNav.emptyNotifications")}
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => openNotification(notif)}
                  className="group px-3 py-3 hover:bg-[var(--color-background-tertiary)] transition-colors cursor-pointer flex gap-3 border-b border-[var(--color-border)] last:border-0 relative"
                >
                  <PlatformAvatar
                    src={notif.channelAvatar}
                    alt={notif.channelDisplayName}
                    platform={notif.platform}
                    size="w-10 h-10"
                    className="ring-offset-1 ring-offset-[var(--color-background-elevated)]"
                  />
                  <div className="flex-1 min-w-0 pr-6">
                    <p className="text-sm text-white">
                      <span
                        className={`font-bold transition-colors ${notif.platform === "twitch" ? "hover:text-[#9146FF]" : "hover:text-[#53FC18]"}`}
                      >
                        {notif.channelDisplayName}
                      </span>{" "}
                      {t("shell.topNav.liveNow")}
                    </p>
                    <div className="text-xs text-white truncate font-medium">{notif.title}</div>
                    <p className="text-[10px] text-white mt-1">
                      {formatRelativeTime(notif.createdAt, t)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissNotification(notif.id);
                    }}
                    className="absolute top-2 right-2 text-white hover:bg-[var(--color-background-elevated)] rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t("shell.topNav.dismiss")}
                  >
                    <LuX size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
          {notifications.length > 0 && (
            <div className="p-2 border-t border-[var(--color-border)] bg-[var(--color-background-elevated)]">
              <button
                className="w-full text-xs text-center py-1.5 text-[var(--color-foreground-secondary)] hover:text-white hover:bg-[var(--color-background-tertiary)] rounded transition-colors"
                onClick={clearNotifications}
              >
                {t("shell.topNav.clearAll")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

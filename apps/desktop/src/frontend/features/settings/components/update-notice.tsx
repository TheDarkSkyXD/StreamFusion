import { useEffect } from "react";
import type { NavigateFn } from "@tanstack/react-router";
import { toast } from "sonner";
import { useUpdater } from "./hooks/useUpdater";
import { translateSettings } from "./presentation/settings-translation";

const UPDATE_NOTICE_ID = "app-update-available";

export function UpdateNotice({ navigate }: { navigate: NavigateFn }) {
  const { status, updateInfo } = useUpdater();
  const version = updateInfo?.version;

  useEffect(() => {
    if (status !== "available" && status !== "downloaded") {
      toast.dismiss(UPDATE_NOTICE_ID);
      return;
    }

    toast.info(
      status === "downloaded"
        ? translateSettings({ key: "settings.updateReadyToInstall" })
        : translateSettings({
            key: "settings.versionValueIsAvailable",
            options: { value1: version ?? "" },
          }),
      {
        id: UPDATE_NOTICE_ID,
        duration: Infinity,
        action: {
          label: translateSettings({ key: "settings.updates" }),
          onClick: () => {
            void navigate({ to: "/settings", search: { tab: "updates" } });
          },
        },
      }
    );
  }, [navigate, status, version]);

  return null;
}

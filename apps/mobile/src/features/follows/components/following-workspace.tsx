import type { NotificationPermissionPort } from "@mobile/features/settings/capabilities/notification-settings";

import type { FollowingSession } from "../capabilities/following-session";
import { FollowingManageScreen } from "./following-manage-screen";
import { FollowingScreen } from "./following-screen";

export function FollowingWorkspace({
  onOpenManage,
  onOpenSearch,
  permission,
  remotePushAvailable = false,
  route,
  session,
}: {
  readonly onOpenManage: () => void;
  readonly onOpenSearch?: () => void;
  readonly permission: NotificationPermissionPort;
  readonly remotePushAvailable?: boolean;
  readonly route: "following" | "following/manage";
  readonly session: FollowingSession;
}) {
  if (route === "following/manage") {
    return (
      <FollowingManageScreen
        permission={permission}
        remotePushAvailable={remotePushAvailable}
        session={session}
      />
    );
  }
  return (
    <FollowingScreen
      onOpenManage={onOpenManage}
      {...(onOpenSearch === undefined ? {} : { onOpenSearch })}
      session={session}
    />
  );
}

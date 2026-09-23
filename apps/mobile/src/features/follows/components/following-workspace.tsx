import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import type { FollowingSession } from "../capabilities/following-session";
import { FollowingManageScreen } from "./following-manage-screen";
import { FollowingScreen } from "./following-screen";
import type { FollowingCategoryTarget } from "./following-tab-body";

export function FollowingWorkspace({
  onOpenCategory,
  onOpenManage,
  onOpenSearch,
  onWatch,
  route,
  session,
}: {
  readonly onOpenCategory?: (category: FollowingCategoryTarget) => void;
  readonly onOpenManage: () => void;
  readonly onOpenSearch?: () => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly route: "following" | "following/manage";
  readonly session: FollowingSession;
}) {
  if (route === "following/manage") {
    return <FollowingManageScreen session={session} />;
  }
  return (
    <FollowingScreen
      onOpenManage={onOpenManage}
      {...(onOpenCategory === undefined ? {} : { onOpenCategory })}
      {...(onOpenSearch === undefined ? {} : { onOpenSearch })}
      {...(onWatch === undefined ? {} : { onWatch })}
      session={session}
    />
  );
}

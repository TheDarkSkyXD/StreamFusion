import { FollowingManageScreen } from "./following-manage-screen";
import { FollowingScreen } from "./following-screen";
import type { FollowingSession } from "../capabilities/following-session";

export function FollowingWorkspace({
  onOpenManage,
  route,
  session,
}: {
  readonly onOpenManage: () => void;
  readonly route: "following" | "following/manage";
  readonly session: FollowingSession;
}) {
  if (route === "following/manage") {
    return <FollowingManageScreen session={session} />;
  }
  return <FollowingScreen onOpenManage={onOpenManage} session={session} />;
}

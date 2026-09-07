import type { FollowRepository } from "../../capabilities/follow-repository";

export function getDesktopFollowRepository(): FollowRepository {
  return window.electronAPI.follows;
}

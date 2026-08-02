import { useFollowStore } from "@/store/follow-store";

export const FOLLOW_HYDRATION_INVOKED_MARK = "streamfusion:follow-hydrate-invoked";

/** Publish the exact preload follow snapshot before React's first root commit. */
export function hydrateFollowsBeforeRendererMount(mount: () => void): Promise<void> {
  performance.mark(FOLLOW_HYDRATION_INVOKED_MARK);
  return useFollowStore.getState().hydrate({ waitForPendingWrites: false }).then(mount, mount);
}

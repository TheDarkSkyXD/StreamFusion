import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { LocalCaptionsPort } from "../capabilities/local-captions";
import {
  createLocalCaptionsController,
  type LocalCaptionsViewModel,
} from "../domain/local-captions-controller";

export type { LocalCaptionsViewModel } from "../domain/local-captions-controller";

export type LocalCaptionsController = Omit<
  ReturnType<typeof createLocalCaptionsController>,
  "getSnapshot" | "subscribe" | "dispose"
> & { readonly model: LocalCaptionsViewModel };

export function useLocalCaptionsController(options: {
  readonly port: LocalCaptionsPort;
}): LocalCaptionsController {
  const controller = useMemo(
    () => createLocalCaptionsController(options.port),
    [options.port],
  );
  useEffect(() => {
    controller.connect();
    void controller.refresh();
    return () => controller.dispose();
  }, [controller]);
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return { ...controller, model };
}

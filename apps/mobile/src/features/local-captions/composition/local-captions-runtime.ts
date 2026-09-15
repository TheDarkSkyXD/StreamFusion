import type { LocalCaptionsPort } from "../capabilities/local-captions";

export function createLocalCaptionsRuntime(options: {
  readonly native: LocalCaptionsPort;
}): LocalCaptionsPort {
  return options.native;
}

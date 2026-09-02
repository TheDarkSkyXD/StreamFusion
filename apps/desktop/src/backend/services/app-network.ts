import { session } from "electron";

export interface AppNetwork {
  readonly fetch: Electron.Session["fetch"];
}

export function createAppNetwork(
  getNetworkSession: () => Pick<Electron.Session, "fetch">
): AppNetwork {
  return {
    fetch(input, init) {
      return getNetworkSession().fetch(input, init);
    },
  };
}

export const appNetwork = createAppNetwork(() => session.defaultSession);

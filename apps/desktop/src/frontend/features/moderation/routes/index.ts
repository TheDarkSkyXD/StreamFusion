import { createPreloadableRoute } from "@/routes/preloadable-route";

export const ModPage = createPreloadableRoute(() =>
  import("../components/screens/Mod").then((module) => ({ default: module.ModPage }))
).Component;
export const ModChannelTwitchPage = createPreloadableRoute(() =>
  import("../components/screens/Mod/channel/ModChannelTwitchPage").then((module) => ({
    default: module.ModChannelTwitchPage,
  }))
).Component;
export const ModChannelKickPage = createPreloadableRoute(() =>
  import("../components/screens/Mod/channel/ModChannelKickPage").then((module) => ({
    default: module.ModChannelKickPage,
  }))
).Component;

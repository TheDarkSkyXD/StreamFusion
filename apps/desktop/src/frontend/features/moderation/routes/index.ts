import { createPreloadableRoute } from "@/routes/preloadable-route";

export const ModPage = createPreloadableRoute(() =>
  import("../../../pages/Mod").then((module) => ({ default: module.ModPage }))
).Component;
export const ModChannelTwitchPage = createPreloadableRoute(() =>
  import("../../../pages/Mod/channel/ModChannelTwitchPage").then((module) => ({
    default: module.ModChannelTwitchPage,
  }))
).Component;
export const ModChannelKickPage = createPreloadableRoute(() =>
  import("../../../pages/Mod/channel/ModChannelKickPage").then((module) => ({
    default: module.ModChannelKickPage,
  }))
).Component;

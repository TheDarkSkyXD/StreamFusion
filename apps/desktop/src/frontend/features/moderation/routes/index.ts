import { lazy } from "react";

export const ModPage = lazy(() =>
  import("../../../pages/Mod").then((module) => ({ default: module.ModPage }))
);
export const ModChannelTwitchPage = lazy(() =>
  import("../../../pages/Mod/channel/ModChannelTwitchPage").then((module) => ({
    default: module.ModChannelTwitchPage,
  }))
);
export const ModChannelKickPage = lazy(() =>
  import("../../../pages/Mod/channel/ModChannelKickPage").then((module) => ({
    default: module.ModChannelKickPage,
  }))
);

export const moderationPageChunkLoaders = [
  () => import("../../../pages/Mod"),
  () => import("../../../pages/Mod/channel/ModChannelTwitchPage"),
  () => import("../../../pages/Mod/channel/ModChannelKickPage"),
];

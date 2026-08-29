import { lazy } from "react";

export const MultiStreamPage = lazy(() =>
  import("../../../pages/MultiStream").then((module) => ({ default: module.MultiStreamPage }))
);

export const multistreamPageChunkLoaders = [() => import("../../../pages/MultiStream")];

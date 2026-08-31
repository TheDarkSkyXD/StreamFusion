import { lazy } from "react";

export const MultiStreamPage = lazy(() =>
  import("../../../pages/MultiStream").then((module) => ({ default: module.MultiStreamPage }))
);

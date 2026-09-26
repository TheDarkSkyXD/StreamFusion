import { createHashHistory, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./start-routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: "/",
    history: typeof window === "undefined" ? createMemoryHistory() : createHashHistory(),
  });
}

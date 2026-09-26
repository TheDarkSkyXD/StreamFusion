import { createFileRoute } from "@tanstack/react-router";
import { ModPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/mod")({
  component: withSuspense(ModPage, { forwardPreload: true }),
});

import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/")({
  component: withSuspense(HomePage, { forwardPreload: true }),
});

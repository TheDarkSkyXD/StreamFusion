import { createFileRoute } from "@tanstack/react-router";
import { MultiStreamPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/multistream")({
  component: withSuspense(MultiStreamPage, { forwardPreload: true }),
});

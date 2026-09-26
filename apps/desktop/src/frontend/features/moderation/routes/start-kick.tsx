import { createFileRoute } from "@tanstack/react-router";
import { ModChannelKickPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/mod/kick/$channel")({
  component: withSuspense(ModChannelKickPage, { forwardPreload: true }),
});

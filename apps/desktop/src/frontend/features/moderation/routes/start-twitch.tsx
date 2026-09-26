import { createFileRoute } from "@tanstack/react-router";
import { ModChannelTwitchPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/mod/twitch/$channel")({
  component: withSuspense(ModChannelTwitchPage, { forwardPreload: true }),
});

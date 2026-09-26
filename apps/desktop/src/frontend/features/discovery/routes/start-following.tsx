import { createFileRoute } from "@tanstack/react-router";
import { FollowingPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/following")({
  component: withSuspense(FollowingPage, { forwardPreload: true }),
});

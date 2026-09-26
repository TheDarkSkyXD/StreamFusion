import { createFileRoute } from "@tanstack/react-router";
import { DownloadsPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/downloads")({
  component: withSuspense(DownloadsPage, { forwardPreload: true }),
});

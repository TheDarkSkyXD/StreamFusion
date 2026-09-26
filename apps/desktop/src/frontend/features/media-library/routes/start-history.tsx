import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/history")({
  component: withSuspense(HistoryPage, { forwardPreload: true }),
});

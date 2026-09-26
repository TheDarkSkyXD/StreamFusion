import { createFileRoute } from "@tanstack/react-router";
import { SearchPage, validateSearchQuery } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/search")({
  validateSearch: validateSearchQuery,
  component: withSuspense(SearchPage, { forwardPreload: true }),
});

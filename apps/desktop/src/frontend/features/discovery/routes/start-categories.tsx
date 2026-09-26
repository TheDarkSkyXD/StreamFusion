import { createFileRoute } from "@tanstack/react-router";
import { CategoriesPage } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/categories")({
  component: withSuspense(CategoriesPage, { forwardPreload: true }),
});

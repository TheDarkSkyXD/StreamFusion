import { createFileRoute } from "@tanstack/react-router";
import { CategoryDetailPage, validateCategoryDetailSearch } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/categories/$platform/$categoryId")({
  validateSearch: validateCategoryDetailSearch,
  component: withSuspense(CategoryDetailPage, { forwardPreload: true }),
});

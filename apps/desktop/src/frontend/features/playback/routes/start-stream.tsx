import { createFileRoute } from "@tanstack/react-router";
import { StreamPage, validateStreamSearch } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/stream/$platform/$channel")({
  validateSearch: validateStreamSearch,
  component: withSuspense(StreamPage, { forwardPreload: true }),
});

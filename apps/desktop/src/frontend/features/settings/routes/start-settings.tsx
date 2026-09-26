import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage, validateSettingsSearch } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/settings")({
  validateSearch: validateSettingsSearch,
  component: withSuspense(SettingsPage, { forwardPreload: true }),
});

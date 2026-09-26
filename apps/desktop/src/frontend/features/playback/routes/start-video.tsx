import { createFileRoute } from "@tanstack/react-router";
import { VideoPage, validateVideoSearch } from "./index";
import { withSuspense } from "@/routes/with-suspense";

export const Route = createFileRoute("/_app/video/$platform/$videoId")({
  validateSearch: validateVideoSearch,
  component: withSuspense(VideoPage, { forwardPreload: true }),
});

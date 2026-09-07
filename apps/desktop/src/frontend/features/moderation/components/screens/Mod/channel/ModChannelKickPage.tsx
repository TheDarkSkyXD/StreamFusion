/**
 * Route component for `/mod/kick/$channel`. Reads the URL param and
 * delegates to the shared ModChannelPage.
 */

import { useParams } from "@tanstack/react-router";

import { ModChannelPage } from "./ModChannelPage";

export function ModChannelKickPage() {
  const { channel } = useParams({ from: "/_app/mod/kick/$channel" });
  return <ModChannelPage platform="kick" channel={channel} />;
}

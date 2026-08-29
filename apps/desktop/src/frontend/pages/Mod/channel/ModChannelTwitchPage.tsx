/**
 * Route component for `/mod/twitch/$channel`. Reads the URL param and
 * delegates to the shared ModChannelPage.
 */

import { useParams } from "@tanstack/react-router";

import { ModChannelPage } from "./ModChannelPage";

export function ModChannelTwitchPage() {
  const { channel } = useParams({ from: "/_app/mod/twitch/$channel" });
  return <ModChannelPage platform="twitch" channel={channel} />;
}

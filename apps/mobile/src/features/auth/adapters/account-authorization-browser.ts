import { KICK_AUTHORIZE_URL } from "@streamfusion/core/auth";
import { getPlatformModule } from "../../../../modules/streamfusion-native-contracts/src/platform";

import type {
  AccountAuthorizationLaunchSignal,
  OpenAccountAuthorization,
} from "../capabilities/account-authorization-browser";

function validateAuthorizationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The authorization page URL is invalid.");
  }
  const twitch = url.origin === "https://www.twitch.tv" && url.pathname === "/activate";
  const kickAuthorize = new URL(KICK_AUTHORIZE_URL);
  const kick = url.origin === kickAuthorize.origin && url.pathname === kickAuthorize.pathname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    (!twitch && !kick)
  )
    throw new Error("The authorization page URL is invalid.");
  return url.toString();
}

export const openAccountAuthorization: OpenAccountAuthorization = async (
  url: string,
  signal: AccountAuthorizationLaunchSignal,
) => {
  if (signal.aborted) return;
  const authorizationUrl = validateAuthorizationUrl(url);

  try {
    await getPlatformModule().openAuthorizationTab(authorizationUrl);
  } catch {
    if (signal.aborted) return;
    throw new Error("In-app sign-in is unavailable. Install or enable a browser with Custom Tabs support.");
  }
};

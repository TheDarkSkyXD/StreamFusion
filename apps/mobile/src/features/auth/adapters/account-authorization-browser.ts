import * as WebBrowser from "expo-web-browser";
import { KICK_AUTHORIZE_URL } from "@streamfusion/core/auth";

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

  let browsers: WebBrowser.WebBrowserCustomTabsResults;
  try {
    browsers = await WebBrowser.getCustomTabsSupportingBrowsersAsync();
  } catch {
    if (signal.aborted) return;
    throw new Error("In-app sign-in is unavailable. Install or enable a browser with Custom Tabs support.");
  }
  if (signal.aborted) return;

  const supporting = browsers.browserPackages.filter((name) =>
    browsers.servicePackages.includes(name),
  );
  const browserPackage =
    [browsers.preferredBrowserPackage, browsers.defaultBrowserPackage].find(
      (name) => name && supporting.includes(name),
    ) ?? supporting[0];
  if (!browserPackage)
    throw new Error("In-app sign-in is unavailable. Install or enable a browser with Custom Tabs support.");
  if (signal.aborted) return;

  let result: WebBrowser.WebBrowserResult;
  try {
    result = await WebBrowser.openBrowserAsync(authorizationUrl, {
      browserPackage,
      createTask: false,
      useProxyActivity: false,
      showInRecents: false,
      showTitle: true,
      enableDefaultShareMenuItem: false,
    });
  } catch {
    if (signal.aborted) return;
    throw new Error("The in-app sign-in page could not be opened. Retry the connection.");
  }
  if (result.type !== "opened" && !signal.aborted)
    throw new Error("The in-app sign-in page could not be opened. Retry the connection.");
};

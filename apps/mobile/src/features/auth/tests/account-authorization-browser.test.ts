import { beforeEach, describe, expect, it, vi } from "vitest";
import * as WebBrowser from "expo-web-browser";

import { openAccountAuthorization } from "../adapters/account-authorization-browser";

vi.mock("expo-web-browser", () => ({
  getCustomTabsSupportingBrowsersAsync: vi.fn(),
  openBrowserAsync: vi.fn(),
  WebBrowserResultType: { OPENED: "opened", LOCKED: "locked" },
}));

const discovery = vi.mocked(WebBrowser.getCustomTabsSupportingBrowsersAsync);
const launch = vi.mocked(WebBrowser.openBrowserAsync);
const twitchUrl = "https://www.twitch.tv/activate";
const kickUrl = "https://id.kick.com/oauth/authorize?state=abc";

beforeEach(() => {
  vi.resetAllMocks();
  discovery.mockResolvedValue({
    browserPackages: ["external.only", "custom.tab"],
    servicePackages: ["custom.tab"],
    defaultBrowserPackage: "external.only",
    preferredBrowserPackage: "custom.tab",
  });
  launch.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.OPENED });
});

describe("account authorization browser", () => {
  it.each([twitchUrl, kickUrl])("opens a supported same-task browser for %s", async (url) => {
    await openAccountAuthorization(url, { aborted: false });
    expect(launch).toHaveBeenCalledWith(url, {
      browserPackage: "custom.tab",
      createTask: false,
      useProxyActivity: false,
      showInRecents: false,
      showTitle: true,
      enableDefaultShareMenuItem: false,
    });
  });

  it("launches the canonical URL after removing a default HTTPS port", async () => {
    await openAccountAuthorization("https://www.twitch.tv:443/activate", { aborted: false });
    expect(launch).toHaveBeenCalledWith(twitchUrl, expect.objectContaining({ createTask: false }));
  });

  it("does not launch if the attempt is cancelled during browser discovery", async () => {
    const deferred = Promise.withResolvers<Awaited<ReturnType<typeof discovery>>>();
    discovery.mockReturnValue(deferred.promise);
    const signal = { aborted: false };
    const opening = openAccountAuthorization(kickUrl, signal);
    signal.aborted = true;
    deferred.resolve({ browserPackages: ["custom.tab"], servicePackages: ["custom.tab"] });
    await opening;
    expect(launch).not.toHaveBeenCalled();

    await openAccountAuthorization(twitchUrl, { aborted: false });
    expect(launch).toHaveBeenCalledExactlyOnceWith(
      twitchUrl,
      expect.objectContaining({ browserPackage: "custom.tab", createTask: false }),
    );
  });

  it("reports an unavailable in-app browser instead of opening a full browser", async () => {
    discovery.mockResolvedValue({
      browserPackages: ["external.only"],
      servicePackages: [],
    });
    await expect(openAccountAuthorization(twitchUrl, { aborted: false })).rejects.toThrow(
      "Install or enable a browser with Custom Tabs support.",
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.twitch.tv/activate",
    "https://user@www.twitch.tv/activate",
    "https://www.twitch.tv:8443/activate",
    "https://www.twitch.tv/activate#fragment",
    "https://www.twitch.tv.evil/activate",
    "https://id.kick.com/oauth/token",
  ])("rejects an unsafe initial URL %s", async (url) => {
    await expect(openAccountAuthorization(url, { aborted: false })).rejects.toThrow(
      "authorization page URL is invalid",
    );
    expect(discovery).not.toHaveBeenCalled();
  });

  it("reports a native launch failure", async () => {
    launch.mockRejectedValue(new Error("native failure"));
    await expect(openAccountAuthorization(twitchUrl, { aborted: false })).rejects.toThrow(
      "in-app sign-in page could not be opened",
    );
  });

  it("rejects a launch that did not open", async () => {
    launch.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.LOCKED });
    await expect(openAccountAuthorization(twitchUrl, { aborted: false })).rejects.toThrow(
      "in-app sign-in page could not be opened",
    );
  });
});

import { describe, expect, it } from "vitest";

import { createGithubStableReleaseCheckPort } from "../adapters/github-stable-release";
import { interpretGithubReleases } from "../domain/github-release";

function release(version: string, prerelease = true) {
  const tag = `android-v${version}`;
  const name = `StreamFusion-${tag}.apk`;
  return {
    tag_name: tag,
    prerelease,
    draft: false,
    body: `Notes for ${version}`,
    assets: [{
      name,
      browser_download_url: `https://github.com/TheDarkSkyXD/StreamFusion/releases/download/${tag}/${name}`,
      size: 178185644,
      digest: `sha256:${"a".repeat(64)}`,
    }, {
      name: "android-update.json",
      browser_download_url: `https://github.com/TheDarkSkyXD/StreamFusion/releases/download/${tag}/android-update.json`,
    }],
  };
}

describe("Android GitHub release checks", () => {
  const releases = [
    { ...release("9.0.0"), tag_name: "v9.0.0" },
    release("0.1.1-alpha.2"),
    release("0.1.1-beta.1"),
    release("0.1.1-rc.1"),
    release("0.1.1", false),
    release("0.2.0-alpha"),
  ];

  it("selects the latest Android prerelease by semantic version", () => {
    expect(interpretGithubReleases({
      installedVersion: "0.1.1-alpha.1",
      allowPrerelease: true,
      payload: releases,
    })).toMatchObject({ status: "available", release: { version: "0.2.0-alpha" } });
  });

  it("uses the stable channel when prereleases are disabled", () => {
    expect(interpretGithubReleases({
      installedVersion: "0.1.1-beta.1",
      allowPrerelease: false,
      payload: releases,
    })).toMatchObject({ status: "available", release: { version: "0.1.1" } });
  });

  it("never offers an older version", () => {
    expect(interpretGithubReleases({
      installedVersion: "0.3.0",
      allowPrerelease: true,
      payload: releases,
    }).status).toBe("current");
  });

  it("treats no stable Android release as a valid current state", () => {
    expect(interpretGithubReleases({
      installedVersion: "0.1.1-alpha",
      allowPrerelease: false,
      payload: [release("0.1.1-alpha")],
    })).toEqual({ status: "current", release: null });
  });

  it("reports malformed GitHub data as an error", () => {
    expect(interpretGithubReleases({
      installedVersion: "0.1.1-alpha",
      allowPrerelease: true,
      payload: { message: "rate limited" },
    })).toEqual({ status: "error", message: "GitHub returned an invalid releases list. Try again." });
  });

  it("reports invalid newer release metadata instead of claiming the app is current", () => {
    const malformed = release("0.4.0", false);
    malformed.assets[0]!.digest = "sha256:bad";
    expect(interpretGithubReleases({
      installedVersion: "0.3.0",
      allowPrerelease: false,
      payload: [malformed],
    })).toEqual({
      status: "error",
      message: "A newer Android release has invalid update metadata. Try again later.",
    });
  });

  it("uses a newer valid release when an older release has invalid metadata", () => {
    const malformed = release("0.4.0", false);
    malformed.assets[0]!.digest = "sha256:bad";
    expect(interpretGithubReleases({
      installedVersion: "0.3.0",
      allowPrerelease: false,
      payload: [malformed, release("0.5.0", false)],
    })).toMatchObject({
      status: "available",
      release: { version: "0.5.0" },
    });
  });

  it("blocks an older valid offer when a newer release has invalid metadata", () => {
    const malformed = release("0.5.0", false);
    malformed.assets[0]!.digest = "sha256:bad";
    expect(interpretGithubReleases({
      installedVersion: "0.3.0",
      allowPrerelease: false,
      payload: [release("0.4.0", false), malformed],
    })).toEqual({
      status: "error",
      message: "A newer Android release has invalid update metadata. Try again later.",
    });
  });

  it("bounds release notes to the native bridge limit", () => {
    const candidate = { ...release("0.5.0", false), body: "x".repeat(40_000) };
    const result = interpretGithubReleases({
      installedVersion: "0.3.0",
      allowPrerelease: false,
      payload: [candidate],
    });
    expect(result.status).toBe("available");
    if (result.status === "available") expect(result.release.notes.length).toBe(32_768);
  });

  it("fetches the release list and retains APK verification metadata", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      expect(url).toBe("https://api.github.com/repos/TheDarkSkyXD/StreamFusion/releases?per_page=100");
      return new Response(JSON.stringify([release("0.1.1-alpha")]), { status: 200 });
    };
    const result = await createGithubStableReleaseCheckPort(fetchImpl).check({
      installedVersion: "0.1.0-alpha",
      allowPrerelease: true,
    });
    expect(result).toMatchObject({
      status: "available",
      release: {
        apkBytes: 178185644,
        apkSha256: "a".repeat(64),
        notes: "Notes for 0.1.1-alpha",
      },
    });
  });

  it("shows an actionable rate-limit error from GitHub", async () => {
    const result = await createGithubStableReleaseCheckPort(
      async () => new Response("rate limited", { status: 403 }),
    ).check({ installedVersion: "0.1.0-alpha", allowPrerelease: true });
    expect(result).toEqual({
      status: "error",
      message: "GitHub rate limited the release check. Try again later.",
    });
  });

  it("shows a connection error when the request fails", async () => {
    const result = await createGithubStableReleaseCheckPort(
      async () => { throw new Error("offline"); },
    ).check({ installedVersion: "0.1.0-alpha", allowPrerelease: true });
    expect(result).toEqual({
      status: "error",
      message: "Could not reach GitHub. Check your connection and try again.",
    });
  });
});

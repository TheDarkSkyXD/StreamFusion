import { interpretGithubLatestRelease } from "../domain/github-release";
import type { SupportReleaseCheckPort } from "../capabilities/support-settings";

const GITHUB_LATEST_RELEASE =
  "https://api.github.com/repos/TheDarkSkyXD/StreamFusion/releases/latest";

export function createGithubStableReleaseCheckPort(
  fetchImpl: typeof fetch = fetch,
): SupportReleaseCheckPort {
  return {
    async check(installedVersion) {
      try {
        const response = await fetchImpl(GITHUB_LATEST_RELEASE, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "StreamFusion-Mobile",
          },
        });
        if (!response.ok) {
          return {
            copy: `GitHub release check returned ${response.status}. Try again when the network is available.`,
            network: "online",
          };
        }
        const payload: unknown = await response.json();
        return {
          copy: interpretGithubLatestRelease({ installedVersion, payload }).copy,
          network: "online",
        };
      } catch {
        return {
          copy: "GitHub is unreachable. Preferences stay on this device. Retry when the network returns.",
          network: "offline",
        };
      }
    },
  };
}

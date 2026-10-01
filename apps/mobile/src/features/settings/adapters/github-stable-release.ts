import { interpretGithubReleases } from "../domain/github-release";
import type { SupportReleaseCheckPort } from "../capabilities/support-settings";

const GITHUB_RELEASES =
  "https://api.github.com/repos/TheDarkSkyXD/StreamFusion/releases?per_page=100";

export function createGithubStableReleaseCheckPort(
  fetchImpl: typeof fetch = fetch,
): SupportReleaseCheckPort {
  return {
    async check(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetchImpl(GITHUB_RELEASES, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          return {
            status: "error",
            message: response.status === 403
              ? "GitHub rate limited the release check. Try again later."
              : `GitHub release check failed (${response.status}). Try again.`,
          };
        }
        return interpretGithubReleases({ ...input, payload: await response.json() });
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error && error.name === "AbortError"
            ? "GitHub release check timed out. Try again."
            : "Could not reach GitHub. Check your connection and try again.",
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

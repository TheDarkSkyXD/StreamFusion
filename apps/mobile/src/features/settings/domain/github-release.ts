export type GithubReleaseCheck = {
  readonly copy: string;
};

export function interpretGithubLatestRelease(input: {
  readonly installedVersion: string;
  readonly payload: unknown;
}): GithubReleaseCheck {
  if (!isRecord(input.payload)) {
    return { copy: "GitHub did not return a stable release payload." };
  }
  if (input.payload.draft === true || input.payload.prerelease === true) {
    return {
      copy: "Ignored a prerelease or draft. Only the latest stable GitHub release counts.",
    };
  }
  const tag = tagName(input.payload.tag_name);
  if (!tag) {
    return { copy: "The latest GitHub release is missing a version tag." };
  }
  if (normalizeVersion(tag) === normalizeVersion(input.installedVersion)) {
    return {
      copy: `Installed ${input.installedVersion} matches stable ${tag}. APK download waits until the native updater ships.`,
    };
  }
  return {
    copy: `Stable ${tag} is published. Installed ${input.installedVersion}. APK download and PackageInstaller wait until the native updater ships.`,
  };
}

function tagName(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVersion(value: string): string {
  return value.replace(/^v/i, "").trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

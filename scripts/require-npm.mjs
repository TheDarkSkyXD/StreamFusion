import { pathToFileURL } from "node:url";

export const REQUIRED_NPM_VERSION = "11.19.0";

export function npmVersionFromUserAgent(userAgent) {
  if (typeof userAgent !== "string") return null;
  return /^npm\/([^\s]+)/.exec(userAgent)?.[1] ?? null;
}

export function assertRequiredNpm(userAgent) {
  const version = npmVersionFromUserAgent(userAgent);
  if (version !== REQUIRED_NPM_VERSION) {
    throw new Error(
      `StreamFusion requires npm ${REQUIRED_NPM_VERSION}. Install it with npm install --global npm@${REQUIRED_NPM_VERSION}.`,
    );
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    assertRequiredNpm(process.env.npm_config_user_agent);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

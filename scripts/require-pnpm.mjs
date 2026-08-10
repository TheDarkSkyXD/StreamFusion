import { pathToFileURL } from "node:url";

const PNPM_USER_AGENT = /^pnpm\//;

export function isPnpmUserAgent(userAgent) {
  return typeof userAgent === "string" && PNPM_USER_AGENT.test(userAgent);
}

export function assertPnpmUserAgent(userAgent) {
  if (!isPnpmUserAgent(userAgent)) {
    throw new Error(
      "StreamFusion dependencies are managed by pnpm. Use pnpm install; npm start remains supported for launching the app.",
    );
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    assertPnpmUserAgent(process.env.npm_config_user_agent);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

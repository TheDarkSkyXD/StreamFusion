interface ResolveUserDataPathOptions {
  argv: readonly string[];
  configuredDevelopmentUserDataPath?: string;
  defaultPath: string;
  developmentPath: string;
  isProduction: boolean;
}

const USER_DATA_DIR_PREFIX = "--user-data-dir=";

function findUserDataDirOverride(argv: readonly string[]): string | undefined {
  for (const [index, argument] of argv.entries()) {
    if (argument.startsWith(USER_DATA_DIR_PREFIX)) {
      return argument.slice(USER_DATA_DIR_PREFIX.length) || undefined;
    }
    if (argument === "--user-data-dir") {
      return argv[index + 1] || undefined;
    }
  }
  return undefined;
}

export function resolveUserDataPath({
  argv,
  configuredDevelopmentUserDataPath,
  defaultPath,
  developmentPath,
  isProduction,
}: ResolveUserDataPathOptions): string {
  const override =
    findUserDataDirOverride(argv) ||
    (!isProduction ? configuredDevelopmentUserDataPath?.trim() : undefined);

  if (override) return override;
  return isProduction ? defaultPath : developmentPath;
}

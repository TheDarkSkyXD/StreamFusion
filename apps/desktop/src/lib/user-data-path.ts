interface ResolveUserDataPathOptions {
  argv: readonly string[];
  defaultPath: string;
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
  defaultPath,
  isProduction,
}: ResolveUserDataPathOptions): string {
  const override = findUserDataDirOverride(argv);

  if (override) return override;
  return isProduction ? defaultPath : `${defaultPath} (Dev)`;
}

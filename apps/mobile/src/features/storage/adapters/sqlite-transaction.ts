const SAVEPOINT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;

export function createSavepointName(now = Date.now(), entropy = Math.random()): string {
  const name = `sf_${now.toString(36)}_${Math.floor(entropy * 1e9).toString(36)}`;
  if (!SAVEPOINT_NAME_PATTERN.test(name)) {
    throw new Error("The savepoint name is invalid.");
  }
  return name;
}

export async function runSavepointTransaction(
  exec: (source: string) => Promise<void>,
  operation: () => Promise<void>,
  name = createSavepointName(),
): Promise<void> {
  await exec(`SAVEPOINT ${name}`);
  try {
    await operation();
    await exec(`RELEASE ${name}`);
  } catch (error) {
    await exec(`ROLLBACK TO ${name}`).catch(() => undefined);
    await exec(`RELEASE ${name}`).catch(() => undefined);
    throw error;
  }
}

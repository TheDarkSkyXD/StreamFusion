import { AsyncLocalStorage } from "node:async_hooks";

type RegistrationRollback = () => void | Promise<void>;

const activeRollbacks = new AsyncLocalStorage<RegistrationRollback[]>();

export function registerFeatureRollback(rollback: RegistrationRollback): void {
  activeRollbacks.getStore()?.push(rollback);
}

export async function runFeatureRegistrationTransaction(
  register: () => Promise<void>
): Promise<void> {
  const rollbacks: RegistrationRollback[] = [];
  try {
    await activeRollbacks.run(rollbacks, register);
  } catch (error) {
    await Promise.allSettled(rollbacks.reverse().map((rollback) => rollback()));
    throw error;
  }
}

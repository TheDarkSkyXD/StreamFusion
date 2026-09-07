export type AppShutdownTask = () => void | Promise<void>;

export function createShutdownRegistry(reportFailure: (key: string, error: unknown) => void) {
  const tasks = new Map<string, AppShutdownTask>();

  return {
    registerAppShutdownTask(key: string, task: AppShutdownTask): () => void {
      tasks.set(key, task);
      return () => {
        if (tasks.get(key) === task) tasks.delete(key);
      };
    },
    runAppShutdownTasks(): void {
      for (const [key, task] of tasks) {
        try {
          void Promise.resolve(task()).catch((error: unknown) => reportFailure(key, error));
        } catch (error) {
          reportFailure(key, error);
        }
      }
    },
  };
}

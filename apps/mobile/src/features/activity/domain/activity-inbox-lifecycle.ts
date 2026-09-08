import type { ActivityRepository } from "@mobile/features/storage/capabilities/persistence";

import {
  createActivityInboxWorkflow,
  initialActivityInboxViewModel,
  type ActivityInboxViewModel,
  type ActivityInboxWorkflow,
} from "./activity-inbox-workflow";

export interface ActivityInboxLifecycle {
  attach(listener: (snapshot: ActivityInboxViewModel) => void): () => void;
  cancelDismissal(): void;
  confirmDismissal(): Promise<void>;
  dismissItem(eventId: string): void;
  dismissAllCompleted(): void;
  markAllRead(): Promise<void>;
  markRead(eventId: string): Promise<void>;
  record(item: Parameters<ActivityInboxWorkflow["record"]>[0]): Promise<void>;
  refresh(): Promise<void>;
  selectFilter(
    filter: Parameters<ActivityInboxWorkflow["selectFilter"]>[0],
  ): void;
  snapshot(): ActivityInboxViewModel;
}

export function createActivityInboxLifecycle(options: {
  readonly now: () => number;
  readonly repository: ActivityRepository;
}): ActivityInboxLifecycle {
  let active: ActivityInboxWorkflow | null = null;

  return {
    attach(listener) {
      const workflow = createActivityInboxWorkflow(options);
      active = workflow;
      const unsubscribe = workflow.subscribe(listener);
      listener(workflow.snapshot());
      void workflow.refresh();
      return () => {
        unsubscribe();
        workflow.dispose();
        if (active === workflow) active = null;
      };
    },
    markAllRead: async () => {
      await active?.markAllRead();
    },
    cancelDismissal() {
      active?.cancelDismissal();
    },
    confirmDismissal: async () => {
      await active?.confirmDismissal();
    },
    dismissItem(eventId) {
      active?.dismissItem(eventId);
    },
    dismissAllCompleted() {
      active?.dismissAllCompleted();
    },
    markRead: async (eventId) => {
      await active?.markRead(eventId);
    },
    record: async (item) => {
      await active?.record(item);
    },
    refresh: async () => {
      await active?.refresh();
    },
    selectFilter(filter) {
      active?.selectFilter(filter);
    },
    snapshot: () => active?.snapshot() ?? initialActivityInboxViewModel,
  };
}

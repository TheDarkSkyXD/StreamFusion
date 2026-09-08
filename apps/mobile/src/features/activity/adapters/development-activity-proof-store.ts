import type {
  DevelopmentActivityProofSessionPort,
  DevelopmentActivityProofSessionRead,
  DevelopmentActivityProofStoreFactory,
} from "@mobile/features/activity/capabilities/development-activity-proof";
import type {
  MobilePersistenceRuntime,
  SecureSecretStore,
} from "@mobile/features/storage/capabilities/persistence";

const sessionKey =
  "streamfusion.development.issue141.activity-proof-session.v1";
const namespacePattern =
  /^activity-proof-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function parseSession(value: string): DevelopmentActivityProofSessionRead {
  try {
    const candidate: unknown = JSON.parse(value);
    if (typeof candidate !== "object" || candidate === null) {
      return { kind: "invalid" };
    }
    const record = candidate as {
      mainActivity?: { count?: unknown; digest?: unknown };
      namespace?: unknown;
      phase?: unknown;
      version?: unknown;
    };
    if (
      record.version !== 1 ||
      typeof record.mainActivity?.count !== "number" ||
      !Number.isSafeInteger(record.mainActivity.count) ||
      record.mainActivity.count < 0 ||
      typeof record.mainActivity.digest !== "string" ||
      !/^[a-f0-9]{8}$/u.test(record.mainActivity.digest) ||
      typeof record.namespace !== "string" ||
      !namespacePattern.test(record.namespace) ||
      (record.phase !== "initializing" &&
        record.phase !== "active" &&
        record.phase !== "cleanup")
    ) {
      return { kind: "invalid" };
    }
    return {
      kind: "session",
      session: {
        mainActivity: {
          count: record.mainActivity.count,
          digest: record.mainActivity.digest,
        },
        namespace: record.namespace,
        phase: record.phase,
        version: 1,
      },
    };
  } catch {
    return { kind: "invalid" };
  }
}

export function createDevelopmentActivityProofSessionPort(
  secretStore: SecureSecretStore,
): DevelopmentActivityProofSessionPort {
  return {
    clear: () => secretStore.delete(sessionKey),
    async read() {
      const stored = await secretStore.get(sessionKey);
      return stored === null ? { kind: "absent" } : parseSession(stored);
    },
    write: (session) => secretStore.set(sessionKey, JSON.stringify(session)),
  };
}

export function createDevelopmentActivityProofStoreFactory(options: {
  readonly cleanup: (namespace: string) => Promise<void>;
  readonly createRuntime: (namespace: string) => MobilePersistenceRuntime;
}): DevelopmentActivityProofStoreFactory {
  return {
    open(namespace) {
      const runtime = options.createRuntime(namespace);
      return {
        activity: runtime.productState.activity,
        cleanup: () => options.cleanup(namespace),
        close: () => runtime.close(),
        initialize: () => runtime.initialize(),
      };
    },
  };
}

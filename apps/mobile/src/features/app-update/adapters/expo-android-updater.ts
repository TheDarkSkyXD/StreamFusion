import { getUpdaterModule } from "../../../../modules/streamfusion-native-contracts/src/contracts";
import type {
  ActiveUpdate,
  AndroidUpdaterPort,
  NativeUpdateCommand,
  UpdateFailure,
  InstallerFailureDetail,
  UpdatePhase,
  UpdateRelease,
  UpdateSnapshot,
} from "../capabilities/android-updater";

const IDLE: UpdateSnapshot = {
  revision: 0,
  phase: { kind: "unsupported", message: "In-app updates require the Android app." },
};
const FAILURE_CODES: ReadonlySet<string> = new Set<UpdateFailure>([
  "network", "storage", "metadata", "checksum", "signature", "package", "version",
  "sdk", "install-blocked", "install-failed", "interrupted",
]);

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFailure(value: unknown): value is UpdateFailure {
  return typeof value === "string" && FAILURE_CODES.has(value);
}

function failureDetail(value: unknown): InstallerFailureDetail | null {
  const raw = record(value);
  if (!raw || typeof raw.status !== "number" || !Number.isInteger(raw.status) ||
    raw.status <= 0 || raw.status > 2_147_483_647 || typeof raw.message !== "string" ||
    raw.message.length === 0 || raw.message.length > 1024 ||
    raw.message !== raw.message.trim()) return null;
  return { status: raw.status, message: raw.message };
}

function release(value: unknown): UpdateRelease | null {
  const raw = record(value);
  if (!raw || typeof raw.tag !== "string" || typeof raw.version !== "string" ||
    !/^android-v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.\d+)?)?$/.test(raw.tag) ||
    raw.version !== raw.tag.slice("android-v".length) ||
    typeof raw.notes !== "string" || typeof raw.releaseUrl !== "string" ||
    raw.notes.length > 32_768 ||
    raw.releaseUrl !== `https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/${raw.tag}` ||
    typeof raw.apkSha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.apkSha256) ||
    typeof raw.apkBytes !== "number" || !Number.isSafeInteger(raw.apkBytes) ||
    raw.apkBytes <= 0 || raw.apkBytes > 1_000_000_000) return null;
  return {
    tag: raw.tag,
    version: raw.version,
    apkBytes: raw.apkBytes,
    apkSha256: raw.apkSha256,
    notes: raw.notes,
    releaseUrl: raw.releaseUrl,
  };
}

function active(raw: Record<string, unknown>): ActiveUpdate | null {
  const parsed = release(raw.release);
  return typeof raw.operation === "string" && raw.operation.length > 0 && parsed
    ? { operation: raw.operation, release: parsed }
    : null;
}

export function parseUpdateSnapshot(value: unknown): UpdateSnapshot {
  const raw = record(value);
  const phaseRaw = record(raw?.phase);
  if (!raw || typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 0 ||
    !phaseRaw || typeof phaseRaw.kind !== "string") throw new Error("Invalid native update snapshot.");
  let phase: UpdatePhase;
  if (phaseRaw.kind === "idle") {
    phase = { kind: "idle" };
  } else if (phaseRaw.kind === "unsupported" && typeof phaseRaw.message === "string") {
    phase = { kind: "unsupported", message: phaseRaw.message };
  } else {
    const facts = active(phaseRaw);
    if (!facts) throw new Error("Invalid native update operation.");
    switch (phaseRaw.kind) {
      case "downloading":
        if (typeof phaseRaw.bytes !== "number" || typeof phaseRaw.total !== "number" ||
          !Number.isSafeInteger(phaseRaw.bytes) || !Number.isSafeInteger(phaseRaw.total) ||
          phaseRaw.bytes < 0 || phaseRaw.total !== facts.release.apkBytes ||
          phaseRaw.bytes > phaseRaw.total) throw new Error("Invalid update progress.");
        phase = { ...facts, kind: "downloading", bytes: phaseRaw.bytes, total: phaseRaw.total };
        break;
      case "paused":
        if (typeof phaseRaw.bytes !== "number" || !Number.isSafeInteger(phaseRaw.bytes) ||
          phaseRaw.bytes < 0 || phaseRaw.bytes > facts.release.apkBytes ||
          (phaseRaw.reason !== "network" && phaseRaw.reason !== "service-limit" &&
            phaseRaw.reason !== "process-interrupted")) throw new Error("Invalid paused update.");
        phase = { ...facts, kind: "paused", bytes: phaseRaw.bytes, reason: phaseRaw.reason };
        break;
      case "verifying":
      case "ready":
      case "permission-needed":
      case "staging":
      case "awaiting-approval":
      case "installed":
      case "canceled":
        phase = { ...facts, kind: phaseRaw.kind };
        break;
      case "failed":
        if (!isFailure(phaseRaw.code) ||
          (phaseRaw.retry !== "download" && phaseRaw.retry !== "install" &&
            phaseRaw.retry !== "none")) throw new Error("Invalid update failure.");
        const detail = phaseRaw.installerFailure === undefined
          ? null
          : failureDetail(phaseRaw.installerFailure);
        if (phaseRaw.installerFailure !== undefined && detail === null) {
          throw new Error("Invalid installer failure detail.");
        }
        phase = {
          ...facts,
          kind: "failed",
          code: phaseRaw.code,
          retry: phaseRaw.retry,
          installerFailure: detail,
        };
        break;
      default:
        throw new Error("Unknown native update phase.");
    }
  }
  return { revision: raw.revision, phase };
}

export function createExpoAndroidUpdaterPort(): AndroidUpdaterPort {
  const native = getUpdaterModule();
  if (!native) {
    return {
      snapshot: async () => IDLE,
      command: async (_command: NativeUpdateCommand) => IDLE,
      subscribe: () => () => {},
    };
  }
  return {
    async snapshot() {
      return parseUpdateSnapshot(await native.snapshot());
    },
    async command(command) {
      return parseUpdateSnapshot(await native.command(command));
    },
    subscribe(listener) {
      const subscription = native.addListener("onUpdateRevision", (event) => {
        const raw = record(event);
        if (raw && Number.isSafeInteger(raw.revision)) listener();
      });
      return () => subscription.remove();
    },
  };
}

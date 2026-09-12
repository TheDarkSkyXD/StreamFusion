import type {
  AndroidCapabilityContracts,
  AndroidNativeOperationResult,
} from "../capabilities/android-capability-contracts";

const safeStubsDetail =
  "3/3 remaining stubs unsupported. Media Jobs canceled a nonexistent job without starting work. Diagnostics returned a measured snapshot.";

export type AndroidCapabilityStubProofResult =
  | {
      readonly detail: typeof safeStubsDetail;
      readonly kind: "safe-stubs";
    }
  | { readonly detail: string; readonly kind: "contained" };

const proofId = "streamfusion-contract-proof-nonexistent";
const proofCapabilities = [
  "playback",
  "media jobs",
  "captions",
  "maintenance",
] as const;

function isMissingJob(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { readonly kind: unknown }).kind === "missing"
  );
}

function failedCapability(
  capability: string,
  result: AndroidNativeOperationResult<unknown>,
): string | undefined {
  if (capability === "media jobs") {
    return result.kind === "completed" && isMissingJob(result.value)
      ? undefined
      : "media jobs did not cancel a nonexistent job without starting work.";
  }
  if (
    result.kind === "unsupported" &&
    result.failure.code === "NATIVE_OPERATION_UNSUPPORTED"
  )
    return undefined;
  return result.kind === "completed"
    ? `${capability} returned a completed result.`
    : `${capability} returned ${result.failure.code}.`;
}

export function createAndroidCapabilityStubProof(
  ports: AndroidCapabilityContracts,
): { readonly run: () => Promise<AndroidCapabilityStubProofResult> } {
  return {
    async run() {
      const results = await Promise.all([
        ports.playback.endFocusedSession(proofId),
        ports.mediaJobs.cancelRecoverableJob(proofId),
        ports.captions.stopFocusedCaptionSession(proofId),
        ports.maintenance.verifyDownloadedApk({
          artifactUri: "file:///data/local/tmp/streamfusion-contract-proof.apk",
          expectedApplicationId: "com.thedarkskyxd.streamfusion.contractproof",
          expectedSha256: "a".repeat(64),
          expectedSignerSha256: "b".repeat(64),
          minimumVersionCode: 1,
        }),
      ]);
      const failures = results
        .map((result, index) =>
          failedCapability(
            proofCapabilities[index] ?? "unknown capability",
            result,
          ),
        )
        .filter((failure): failure is string => failure !== undefined);
      const diagnostics = await ports.diagnostics.readResourceSnapshot();
      return failures.length === 0 && diagnostics.kind === "completed"
        ? {
            detail: safeStubsDetail,
            kind: "safe-stubs",
          }
        : {
            detail:
              diagnostics.kind === "completed"
                ? failures.join(" ")
                : `${failures.join(" ")} Diagnostics returned ${diagnostics.failure.code}.`,
            kind: "contained",
          };
    },
  };
}

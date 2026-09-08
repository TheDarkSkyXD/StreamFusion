import type {
  AndroidCapabilityContracts,
  AndroidNativeOperationResult,
} from "../capabilities/android-capability-contracts";

export type AndroidCapabilityStubProofResult =
  | {
      readonly detail: "4/4 current Android contract stubs safely returned unsupported. Diagnostics returned a measured resource snapshot.";
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

function failedCapability(
  capability: string,
  result: AndroidNativeOperationResult<unknown>,
): string | undefined {
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
      return failures.length === 0
        && diagnostics.kind === "completed"
        ? {
            detail:
              "4/4 current Android contract stubs safely returned unsupported. Diagnostics returned a measured resource snapshot.",
            kind: "safe-stubs",
          }
        : {
            detail: diagnostics.kind === "completed"
              ? failures.join(" ")
              : `${failures.join(" ")} Diagnostics returned ${diagnostics.failure.code}.`,
            kind: "contained",
          };
    },
  };
}

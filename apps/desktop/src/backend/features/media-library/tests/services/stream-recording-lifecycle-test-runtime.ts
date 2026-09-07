import { createStreamRecordingArtifactProbe } from "@backend/features/media-library/adapters/node/stream-recording-artifact-probe";
import {
  cleanupRecordingSectionPaths,
  createStreamRecordingSectionFinalizer,
  deleteRecordingArtifactPaths,
  verifyStreamRecordingArtifactIdentity,
} from "@backend/features/media-library/adapters/node/stream-recording-section-finalizer";
import {
  createOwnedRecordingSectionPath,
  isOwnedRecordingOutput,
  isOwnedRecordingSection,
  isRecordingSectionAvailable,
} from "@backend/features/media-library/adapters/node/stream-recording-paths";
import type { StreamRecordingLifecycle } from "@backend/features/media-library/capabilities/stream-recording-lifecycle";

export function createStreamRecordingTestLifecycle(): StreamRecordingLifecycle {
  return {
    sectionFinalizer: createStreamRecordingSectionFinalizer(),
    probeArtifact: createStreamRecordingArtifactProbe(),
    cleanupSections: cleanupRecordingSectionPaths,
    discardArtifacts: deleteRecordingArtifactPaths,
    cleanupFailedArtifact: cleanupRecordingSectionPaths,
    cleanupAbortedSection: async (sectionPath) => cleanupRecordingSectionPaths([sectionPath]),
    isRecordingSectionAvailable,
    verifyArtifactIdentity: verifyStreamRecordingArtifactIdentity,
    createSectionPath: (destinationPath, sectionNumber, sessionId) =>
      createOwnedRecordingSectionPath(destinationPath, sessionId, sectionNumber),
    isOwnedRecordingSection,
    isOwnedRecordingOutput,
  };
}

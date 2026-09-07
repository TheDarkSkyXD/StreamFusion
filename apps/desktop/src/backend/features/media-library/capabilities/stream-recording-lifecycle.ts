import type {
  StreamRecordingArtifactIdentity,
  StreamRecordingSection,
} from "@shared/stream-recording-types";

export interface StreamRecordingCommitIntent {
  outputPath: string;
  format: "mp4" | "ts";
  usedFallback: boolean;
  artifactIdentity: StreamRecordingArtifactIdentity;
}

export interface StreamRecordingSectionFinalizer {
  finalize(input: {
    ffmpegPath: string;
    destinationPath: string;
    sections: Pick<StreamRecordingSection, "id" | "path">[];
    beforeCommit?: (intent: StreamRecordingCommitIntent) => Promise<void>;
  }): Promise<{
    outputPath: string;
    format: "mp4" | "ts";
    usedFallback: boolean;
    ownedSectionPaths: string[];
    artifactIdentity: StreamRecordingArtifactIdentity;
  }>;
}

export type StreamRecordingArtifactProbe = (input: {
  ffmpegPath: string;
  outputPath: string;
}) => Promise<boolean>;

export interface StreamRecordingLifecycle {
  sectionFinalizer: StreamRecordingSectionFinalizer;
  probeArtifact: StreamRecordingArtifactProbe;
  cleanupSections(paths: string[]): Promise<void>;
  discardArtifacts(paths: string[]): Promise<void>;
  cleanupFailedArtifact(paths: string[]): Promise<void>;
  cleanupAbortedSection(path: string): Promise<void>;
  isRecordingSectionAvailable(path: string): Promise<boolean>;
  verifyArtifactIdentity(
    path: string,
    identity: StreamRecordingArtifactIdentity
  ): Promise<boolean>;
  createSectionPath(destinationPath: string, sectionNumber: number, sessionId: string): string;
  isOwnedRecordingSection(
    destinationPath: string,
    sessionId: string,
    sectionNumber: number,
    section: StreamRecordingSection
  ): boolean;
  isOwnedRecordingOutput(
    destinationPath: string,
    outputPath: string,
    format: "mp4" | "ts",
    usedFallback: boolean
  ): boolean;
}

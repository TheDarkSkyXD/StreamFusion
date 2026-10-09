import type { Meta, StoryObj } from "@storybook/react";
import { UpdateDialog } from "./update-dialog";
import { updatePresentation } from "../domain/update-presentation";
import type { UpdatePhase, UpdateRelease } from "../capabilities/android-updater";

const release: UpdateRelease = {
  tag: "android-v0.1.6-alpha.3",
  version: "0.1.6-alpha.3",
  apkBytes: 178_185_644,
  apkSha256: "a".repeat(64),
  notes: "Player fixes.",
  releaseUrl: "https://github.com/TheDarkSkyXD/StreamFusion/releases/tag/android-v0.1.6-alpha.3",
};

function Story({ phase, operationError }: { readonly phase: UpdatePhase; readonly operationError?: string }) {
  return (
    <UpdateDialog
      model={updatePresentation(phase, release)}
      onAction={() => {}}
      operationError={operationError ?? null}
      visible
    />
  );
}

const meta = {
  title: "Android/Updates",
  component: Story,
} satisfies Meta<typeof Story>;
export default meta;

type StoryCase = StoryObj<typeof meta>;

export const Available: StoryCase = { name: "Available: Update starts both steps", args: { phase: { kind: "idle" } } };
export const Downloading: StoryCase = {
  args: { phase: { kind: "downloading", operation: "story-1", release, bytes: 89_000_000, total: release.apkBytes } },
};
export const Paused: StoryCase = {
  args: { phase: { kind: "paused", operation: "story-1", release, bytes: 89_000_000, reason: "network" } },
};
export const Verifying: StoryCase = {
  args: { phase: { kind: "verifying", operation: "story-1", release } },
};
export const Ready: StoryCase = {
  args: { phase: { kind: "ready", operation: "story-1", release } },
};
export const ReadyWithActionError: StoryCase = {
  args: {
    phase: { kind: "ready", operation: "story-1", release },
    operationError: "The Android update action failed. Try again.",
  },
};
export const PermissionNeeded: StoryCase = {
  args: { phase: { kind: "permission-needed", operation: "story-1", release } },
};
export const Staging: StoryCase = {
  args: { phase: { kind: "staging", operation: "story-1", release } },
};
export const AwaitingApproval: StoryCase = {
  args: { phase: { kind: "awaiting-approval", operation: "story-1", release } },
};
export const Installed: StoryCase = {
  args: { phase: { kind: "installed", operation: "story-1", release } },
};
export const Canceled: StoryCase = {
  args: { phase: { kind: "canceled", operation: "story-1", release } },
};
export const Failed: StoryCase = {
  args: { phase: { kind: "failed", operation: "story-1", release, code: "checksum", retry: "download" } },
};
export const Unsupported: StoryCase = {
  args: { phase: { kind: "unsupported", message: "In-app updates require the Android app." } },
};

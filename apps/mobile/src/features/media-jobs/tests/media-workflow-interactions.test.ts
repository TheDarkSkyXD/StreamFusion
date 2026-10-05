// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asMediaJobId,
  createQueuedMediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";
import { MediaJobScreen } from "../components/media-job-screen";
import { DownloadsScreen } from "../components/downloads-screen";
import { WatchDownloadBar } from "@mobile/features/watch/components/watch-download-bar";
import { CaptionModelManagement } from "@mobile/features/local-captions/components/caption-model-management";
const fields = vi.hoisted(() => new Map<string, (value: string) => void>());
vi.mock("react-native", async () => {
  const { createElement } = await import("react");
  const host = (tag: string) => (props: Record<string, unknown>) =>
    createElement(tag, { "data-testid": props.testID }, props.children);
  return {
    View: host("div"),
    Text: host("span"),
    Image: host("div"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    RefreshControl: host("div"),
    Platform: { OS: "android" },
    StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
    Modal: (props: Record<string, unknown>) =>
      props.visible ? createElement("div", {}, props.children) : null,
    TextInput: (props: {
      accessibilityLabel: string;
      onChangeText: (value: string) => void;
    }) => {
      fields.set(props.accessibilityLabel, props.onChangeText);
      return createElement("input", { "aria-label": props.accessibilityLabel });
    },
    Pressable: (props: Record<string, unknown>) =>
      createElement(
        "button",
        {
          "data-testid": props.testID,
          "aria-label": props.accessibilityLabel,
          disabled: props.disabled,
          onClick: props.onPress,
        },
        props.children,
      ),
  };
});
vi.mock("lucide-react-native", () => ({ ChevronRight: "svg" }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@mobile/design/haptics", () => ({
  impactHaptic: async () => undefined,
  warningHaptic: async () => undefined,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()));
  roots.length = 0;
  fields.clear();
});
function render(node: Parameters<ReturnType<typeof createRoot>["render"]>[0]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}
function click(container: HTMLElement, testID: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `[data-testid="${testID}"]`,
  );
  if (!button) throw new Error(`Missing ${testID}`);
  act(() => button.click());
}
const queued = createQueuedMediaJobSnapshot({
  schemaVersion: 1,
  jobId: asMediaJobId("real-job"),
  kind: "download",
  sourceUri: "https://example.test/video.mp4",
  createdAt: toSerializedTimestamp("2026-10-05T00:00:00.000Z"),
});
describe("media workflow controls", () => {
  it("filters persisted jobs by kind and channel search while retaining row navigation", () => {
    const video = {
      ...queued,
      intent: {
        ...queued.intent,
        display: {
          title: "Broadcast",
          channelName: "First channel",
          platform: "twitch",
          contentKind: "video",
          sourceIdentity: "one",
          thumbnailUrl: null,
        },
      },
    } as const;
    const clip = {
      ...queued,
      intent: {
        ...queued.intent,
        jobId: asMediaJobId("clip-job"),
        display: {
          title: "Highlight",
          channelName: "Second channel",
          platform: "kick",
          contentKind: "clip",
          sourceIdentity: "two",
          thumbnailUrl: null,
        },
      },
    } as const;
    const open = vi.fn();
    const container = render(
      createElement(DownloadsScreen, { jobs: [video, clip], onOpenJob: open }),
    );
    click(container, "downloads-filter-clip");
    expect(container.textContent).toContain("Highlight");
    expect(container.textContent).not.toContain("Broadcast");
    click(container, "downloads-open-clip-job");
    expect(open).toHaveBeenCalledWith("clip-job");
    click(container, "downloads-filter-all");
    act(() => fields.get("Search downloads")?.("first channel"));
    expect(container.textContent).toContain("Broadcast");
    expect(container.textContent).not.toContain("Highlight");
  });
  it("keeps a partial recording only after confirmation and deletes only after a separate confirmation", () => {
    const snapshot = {
      ...queued,
      phase: "completed",
      intent: { ...queued.intent, kind: "recording" },
      artifact: {
        kind: "partial",
        relativePath: "media-jobs/real-job/artifact.bin",
        bytes: 4096,
      },
    } as const;
    const command = vi.fn();
    const remove = vi.fn();
    const container = render(
      createElement(MediaJobScreen, {
        snapshot,
        onCommand: command,
        onDelete: remove,
      }),
    );
    click(container, "media-job-command-finalize");
    expect(command).not.toHaveBeenCalled();
    click(container, "dialog-cancel");
    expect(command).not.toHaveBeenCalled();
    click(container, "media-job-command-finalize");
    click(container, "dialog-confirm");
    expect(command).toHaveBeenCalledWith("finalize");
    click(container, "media-job-delete");
    expect(remove).not.toHaveBeenCalled();
    click(container, "dialog-confirm");
    expect(remove).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[data-testid="media-job-open"]'),
    ).toBeNull();
  });
  it("creates a separate copy only after the explicit Download again dialog", () => {
    const again = vi.fn();
    const container = render(
      createElement(WatchDownloadBar, {
        eligibility: {
          kind: "eligible",
          jobId: queued.intent.jobId,
          label: "Download video",
        },
        job: queued,
        onStart: vi.fn(),
        onStartAgain: again,
        onCommand: vi.fn(),
        onDelete: vi.fn(),
        onExport: vi.fn(),
        onOpenArtifact: vi.fn(),
      }),
    );
    click(container, "watch-download-again");
    expect(again).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Your existing file will be kept.");
    click(container, "dialog-cancel");
    expect(again).not.toHaveBeenCalled();
    click(container, "watch-download-again");
    click(container, "dialog-confirm");
    expect(again).toHaveBeenCalledOnce();
  });
  it("shows real caption download bytes and sends cancel without a remove command", () => {
    const cancel = vi.fn();
    const remove = vi.fn();
    const model = {
      modelId: "english-v1",
      phase: "downloading",
      pack: "none",
      installed: false,
      sha256Verified: false,
      downloadedBytes: 1048576,
      expectedBytes: 41205931,
      displaySize: "39.30 MiB",
      languageLabel: "English",
      license: "Apache-2.0",
      statusMessage: "Downloading",
      audioUploadAttempts: 0,
    } as const;
    const container = render(
      createElement(CaptionModelManagement, {
        busy: true,
        model,
        status: null,
        onInstall: vi.fn(),
        onRemove: remove,
        onCancelInstall: cancel,
      }),
    );
    click(container, "watch-caption-models");
    expect(container.textContent).toContain("1.00 MiB of 39.30 MiB");
    click(container, "caption-model-cancel");
    expect(cancel).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });
});

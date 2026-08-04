import { act, waitFor } from "@testing-library/react";
import { forwardRef, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountTwitchAdFrameProofPanel,
  type TwitchAdFrameProofDiagnostic,
} from "@/dev-relay/twitch-ad-frame-proof-panel";
import type { TwitchLivePlayerProps } from "@/components/player/twitch/twitch-live-player";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";

const mountedPanels: ReturnType<typeof mountTwitchAdFrameProofPanel>[] = [];

async function mountPanel(
  options: Parameters<typeof mountTwitchAdFrameProofPanel>[0]
): Promise<ReturnType<typeof mountTwitchAdFrameProofPanel>> {
  let controller: ReturnType<typeof mountTwitchAdFrameProofPanel> | undefined;
  await act(async () => {
    controller = mountTwitchAdFrameProofPanel(options);
  });
  mountedPanels.push(controller!);
  return controller!;
}

// Guards: a proof-player render failure removes the diagnostic panel without obscuring or replacing the normal StreamFusion UI.
describe("Twitch ad-frame proof panel", () => {
  afterEach(async () => {
    await act(async () => {
      for (const controller of mountedPanels.splice(0)) controller.cleanup();
    });
    document.getElementById("twitch-ad-frame-proof-panel")?.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("fails closed and restores the normal UI when the proof player cannot render", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const normalApp = document.createElement("main");
    normalApp.textContent = "Normal StreamFusion UI";
    document.body.appendChild(normalApp);
    const diagnostics: TwitchAdFrameProofDiagnostic[] = [];
    const BrokenPlayer = forwardRef<HTMLVideoElement>(() => {
      throw new Error("proof player render failed");
    });

    const controller = await mountPanel({
      runId: "adframe-20260803-r4",
      PlayerComponent: BrokenPlayer,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await waitFor(() => {
      expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeNull();
    });

    expect(normalApp).toBeInTheDocument();
    expect(normalApp).toHaveTextContent("Normal StreamFusion UI");
    expect(controller.getSnapshot()).toMatchObject({
      state: "failed",
      failureKind: "render-error",
    });
    expect(diagnostics.at(-1)).toMatchObject({
      kind: "render-error",
      message: "proof player render failed",
    });
  });

  it("removes the panel when no real video reaches the clean-frame bootstrap boundary", async () => {
    vi.useFakeTimers();
    const diagnostics: TwitchAdFrameProofDiagnostic[] = [];
    const EmptyPlayer = forwardRef<HTMLVideoElement>(() => <div>Waiting for player</div>);

    const controller = await mountPanel({
      runId: "adframe-20260803-r4",
      PlayerComponent: EmptyPlayer,
      bootstrapTimeoutMs: 250,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      state: "failed",
      failureKind: "mount-timeout",
    });
    expect(diagnostics.at(-1)).toMatchObject({
      kind: "mount-timeout",
    });
  });

  it("captures a window error and removes only the proof panel", async () => {
    const normalApp = document.createElement("main");
    normalApp.textContent = "Normal StreamFusion UI";
    document.body.appendChild(normalApp);
    const diagnostics: TwitchAdFrameProofDiagnostic[] = [];
    const WaitingPlayer = forwardRef<HTMLVideoElement>(() => <video />);

    const controller = await mountPanel({
      runId: "adframe-20260803-r4",
      PlayerComponent: WaitingPlayer,
      bootstrapTimeoutMs: 5_000,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await act(async () => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          error: new Error("fixture mount exploded"),
          message: "fixture mount exploded",
        })
      );
    });

    await waitFor(() => {
      expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeNull();
    });

    expect(normalApp).toBeInTheDocument();
    expect(controller.getSnapshot()).toMatchObject({
      state: "failed",
      failureKind: "window-error",
    });
    expect(diagnostics.at(-1)).toMatchObject({
      kind: "window-error",
      message: "fixture mount exploded",
    });
  });

  it("captures an unhandled rejection and removes only the proof panel", async () => {
    const normalApp = document.createElement("main");
    normalApp.textContent = "Normal StreamFusion UI";
    document.body.appendChild(normalApp);
    const diagnostics: TwitchAdFrameProofDiagnostic[] = [];
    const WaitingPlayer = forwardRef<HTMLVideoElement>(() => <video />);

    const controller = await mountPanel({
      runId: "adframe-20260803-r4",
      PlayerComponent: WaitingPlayer,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const rejection = new Event("unhandledrejection", { cancelable: true });
    Object.defineProperty(rejection, "reason", {
      value: new Error("proof promise rejected"),
    });

    await act(async () => {
      window.dispatchEvent(rejection);
    });

    await waitFor(() => {
      expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeNull();
    });

    expect(normalApp).toBeInTheDocument();
    expect(controller.getSnapshot()).toMatchObject({
      state: "failed",
      failureKind: "unhandled-rejection",
    });
    expect(diagnostics.at(-1)).toMatchObject({
      kind: "unhandled-rejection",
      message: "proof promise rejected",
    });
  });

  it("reports readiness only after a connected video presents the expected clean frame", async () => {
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const ReadyPlayer = forwardRef<HTMLVideoElement, TwitchLivePlayerProps>(({ onReady }, ref) => {
      useEffect(() => onReady?.(), [onReady]);
      return <video ref={ref} />;
    });

    const controller = await mountPanel({
      runId: "adframe-20260803-r4",
      PlayerComponent: ReadyPlayer,
      bootstrapTimeoutMs: 5_000,
      isExpectedCleanFrame: () => true,
    });

    await waitFor(() => expect(frameCallbacks).toHaveLength(1));
    expect(controller.getSnapshot().state).toBe("mounting");

    await act(async () => {
      frameCallbacks[0](0, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    });

    await waitFor(() => expect(controller.getSnapshot().state).toBe("ready"));
    const panel = document.getElementById("twitch-ad-frame-proof-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveStyle({ width: "420px", height: "260px" });
    expect(panel?.style.inset).toBe("");
    expect(panel?.querySelector("video")).toBeInTheDocument();
  });

  it("provides the player contexts required by an isolated Twitch player root", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const frameCallbacks: VideoFrameRequestCallback[] = [];
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      }),
    });
    const ContextPlayer = forwardRef<HTMLVideoElement, TwitchLivePlayerProps>(
      ({ onReady }, ref) => {
        useEffect(() => onReady?.(), [onReady]);
        return (
          <>
            <Tooltip>
              <TooltipTrigger>Player controls</TooltipTrigger>
            </Tooltip>
            <video ref={ref} />
          </>
        );
      }
    );

    const controller = await mountPanel({
      runId: "adframe-20260803-r4",
      PlayerComponent: ContextPlayer,
      isExpectedCleanFrame: () => true,
    });

    await waitFor(() => expect(frameCallbacks).toHaveLength(1));
    await act(async () => {
      frameCallbacks[0](0, { mediaTime: 1 } as VideoFrameCallbackMetadata);
    });

    await waitFor(() => expect(controller.getSnapshot().state).toBe("ready"));
    expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeInTheDocument();
    expect(controller.getSnapshot().failureKind).toBeNull();
  });
});

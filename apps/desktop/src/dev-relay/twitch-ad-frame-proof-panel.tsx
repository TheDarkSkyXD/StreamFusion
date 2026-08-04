import {
  Component,
  createRef,
  type ErrorInfo,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from "react";
import { createRoot } from "react-dom/client";

import {
  TwitchLivePlayer,
  type TwitchLivePlayerProps,
} from "@/components/player/twitch/twitch-live-player";
import { PersistentPlayerShell } from "@/components/player/persistent-player-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

const PANEL_ID = "twitch-ad-frame-proof-panel";

type ProofPlayerComponent = ForwardRefExoticComponent<
  TwitchLivePlayerProps & RefAttributes<HTMLVideoElement>
>;

export interface TwitchAdFrameProofDiagnostic {
  kind: "mount-timeout" | "render-error" | "unhandled-rejection" | "window-error";
  message: string;
}

export interface TwitchAdFrameProofSnapshot {
  state: "mounting" | "failed" | "ready";
  failureKind: TwitchAdFrameProofDiagnostic["kind"] | null;
}

export interface TwitchAdFrameProofPanelController {
  cleanup: () => void;
  getSnapshot: () => TwitchAdFrameProofSnapshot;
}

interface TwitchAdFrameProofPanelOptions {
  runId: string;
  PlayerComponent?: ProofPlayerComponent;
  bootstrapTimeoutMs?: number;
  isExpectedCleanFrame?: (video: HTMLVideoElement) => boolean;
  onDiagnostic?: (diagnostic: TwitchAdFrameProofDiagnostic) => void;
}

interface ProofErrorBoundaryProps {
  children: React.ReactNode;
  onError: (error: Error) => void;
}

class ProofErrorBoundary extends Component<ProofErrorBoundaryProps> {
  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    this.props.onError(error);
  }

  render(): React.ReactNode {
    return this.props.children;
  }
}

function isBlueFixtureFrame(video: HTMLVideoElement): boolean {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return false;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;

  try {
    context.drawImage(video, video.videoWidth / 2, video.videoHeight / 2, 1, 1, 0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return blue >= 96 && blue > red * 1.5 && blue > green * 1.5;
  } catch {
    return false;
  }
}

export function mountTwitchAdFrameProofPanel({
  runId,
  PlayerComponent = TwitchLivePlayer,
  bootstrapTimeoutMs = 8_000,
  isExpectedCleanFrame = isBlueFixtureFrame,
  onDiagnostic,
}: TwitchAdFrameProofPanelOptions): TwitchAdFrameProofPanelController {
  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  panel.setAttribute("aria-label", "Twitch ad-frame proof diagnostics");
  Object.assign(panel.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    width: "420px",
    height: "260px",
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "calc(100vh - 64px)",
    zIndex: "60",
    background: "#050505",
    border: "1px solid #3f3f46",
    borderRadius: "8px",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
    overflow: "hidden",
  });
  document.body.appendChild(panel);

  const root = createRoot(panel, {
    onCaughtError: (error) => {
      fail({ kind: "render-error", message: errorMessage(error) });
    },
    onUncaughtError: (error) => {
      fail({ kind: "render-error", message: errorMessage(error) });
    },
    onRecoverableError: (error) => {
      fail({ kind: "render-error", message: errorMessage(error) });
    },
  });
  const videoRef = createRef<HTMLVideoElement>();
  let snapshot: TwitchAdFrameProofSnapshot = {
    state: "mounting",
    failureKind: null,
  };
  let cleaned = false;
  let mountTimeout: number | null = null;

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    if (mountTimeout !== null) window.clearTimeout(mountTimeout);
    window.removeEventListener("error", handleWindowError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    root.unmount();
    panel.remove();
  }

  function fail(diagnostic: TwitchAdFrameProofDiagnostic): void {
    if (cleaned || snapshot.state === "failed") return;
    snapshot = { state: "failed", failureKind: diagnostic.kind };
    onDiagnostic?.(diagnostic);
    queueMicrotask(cleanup);
  }

  function handleWindowError(event: ErrorEvent): void {
    event.preventDefault();
    fail({
      kind: "window-error",
      message: event.error instanceof Error ? event.error.message : event.message,
    });
  }

  function handleUnhandledRejection(event: PromiseRejectionEvent): void {
    event.preventDefault();
    const reason = event.reason;
    fail({
      kind: "unhandled-rejection",
      message: reason instanceof Error ? reason.message : String(reason),
    });
  }

  function observeFirstCleanFrame(): void {
    const video = videoRef.current;
    if (!video?.isConnected || typeof video.requestVideoFrameCallback !== "function") return;

    video.requestVideoFrameCallback(() => {
      if (cleaned || snapshot.state !== "mounting") return;
      if (!video.isConnected || getComputedStyle(video).opacity === "0") return;
      if (!isExpectedCleanFrame(video)) {
        observeFirstCleanFrame();
        return;
      }

      snapshot = { state: "ready", failureKind: null };
      if (mountTimeout !== null) window.clearTimeout(mountTimeout);
      mountTimeout = null;
      panel.dataset.proofState = "ready";
      const status = panel.querySelector<HTMLElement>("[data-proof-status]");
      if (status) status.textContent = "Twitch ad-frame proof - clean frame ready";
    });
  }

  window.addEventListener("error", handleWindowError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  // timer-allowlist: dev proof mount deadline is explicitly cleared on clean-frame success and controller cleanup
  mountTimeout = window.setTimeout(() => {
    fail({
      kind: "mount-timeout",
      message: "Proof player did not present a clean frame before the mount deadline",
    });
  }, bootstrapTimeoutMs);

  root.render(
    <ProofErrorBoundary onError={(error) => fail({ kind: "render-error", message: error.message })}>
      <TooltipProvider>
        <PersistentPlayerShell>
          <div className="flex size-full flex-col bg-black text-white">
            <div
              data-proof-status
              className="h-8 shrink-0 border-b border-white/15 px-3 py-1 text-xs font-medium"
            >
              Twitch ad-frame proof - mounting
            </div>
            <div className="min-h-0 flex-1">
              <PlayerComponent
                ref={videoRef}
                streamUrl={`/__streamfusion-proof/twitch-ad-frame/${runId}/usher.ttvnw.net/api/channel/hls/fixtureproof.m3u8`}
                channelName="fixtureproof"
                autoPlay
                muted={false}
                enableAdBlock
                onReady={observeFirstCleanFrame}
              />
            </div>
          </div>
        </PersistentPlayerShell>
      </TooltipProvider>
    </ProofErrorBoundary>
  );

  return {
    cleanup,
    getSnapshot: () => ({ ...snapshot }),
  };
}

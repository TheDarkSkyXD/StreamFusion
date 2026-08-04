import type {
  TwitchAdFrameProofDiagnostic,
  TwitchAdFrameProofPanelController,
} from "./twitch-ad-frame-proof-panel";

const PANEL_ID = "twitch-ad-frame-proof-panel";

interface ProofPanelModule {
  mountTwitchAdFrameProofPanel: (options: {
    runId: string;
    onDiagnostic?: (diagnostic: TwitchAdFrameProofDiagnostic) => void;
  }) => TwitchAdFrameProofPanelController;
}

export interface TwitchAdFrameProofBootstrapDiagnostic {
  kind: "import-error" | "mount-error";
  message: string;
}

export type TwitchAdFrameProofRuntimeDiagnostic =
  TwitchAdFrameProofBootstrapDiagnostic | TwitchAdFrameProofDiagnostic;

interface TwitchAdFrameProofBootstrapOptions {
  runId: string;
  loadPanel?: () => Promise<ProofPanelModule>;
  onDiagnostic?: (diagnostic: TwitchAdFrameProofRuntimeDiagnostic) => void;
}

export type TwitchAdFrameProofBootstrapResult =
  | {
      state: "mounting";
      controller: TwitchAdFrameProofPanelController;
    }
  | {
      state: "failed";
      diagnostic: TwitchAdFrameProofBootstrapDiagnostic;
    };

function removePartialPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

function failedResult(
  kind: TwitchAdFrameProofBootstrapDiagnostic["kind"],
  error: unknown,
  onDiagnostic?: (diagnostic: TwitchAdFrameProofRuntimeDiagnostic) => void
): TwitchAdFrameProofBootstrapResult {
  removePartialPanel();
  const diagnostic = {
    kind,
    message: error instanceof Error ? error.message : String(error),
  } satisfies TwitchAdFrameProofBootstrapDiagnostic;
  onDiagnostic?.(diagnostic);
  return { state: "failed", diagnostic };
}

export async function startTwitchAdFrameProof({
  runId,
  loadPanel = () => import("./twitch-ad-frame-proof-panel"),
  onDiagnostic,
}: TwitchAdFrameProofBootstrapOptions): Promise<TwitchAdFrameProofBootstrapResult> {
  let panelModule: ProofPanelModule;
  try {
    panelModule = await loadPanel();
  } catch (error) {
    return failedResult("import-error", error, onDiagnostic);
  }

  try {
    const controller = panelModule.mountTwitchAdFrameProofPanel({ runId, onDiagnostic });
    return { state: "mounting", controller };
  } catch (error) {
    return failedResult("mount-error", error, onDiagnostic);
  }
}

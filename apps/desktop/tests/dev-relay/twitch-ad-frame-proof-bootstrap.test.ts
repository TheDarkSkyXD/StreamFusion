import { describe, expect, it, vi } from "vitest";

import { startTwitchAdFrameProof } from "@/dev-relay/twitch-ad-frame-proof-bootstrap";

describe("Twitch ad-frame proof bootstrap", () => {
  it("removes a partial proof panel and reports a failed import without changing the app root", async () => {
    const normalApp = document.createElement("main");
    normalApp.textContent = "Normal StreamFusion UI";
    document.body.appendChild(normalApp);
    const partialPanel = document.createElement("section");
    partialPanel.id = "twitch-ad-frame-proof-panel";
    document.body.appendChild(partialPanel);
    const onDiagnostic = vi.fn();

    const result = await startTwitchAdFrameProof({
      runId: "adframe-20260803-r4",
      loadPanel: async () => {
        throw new Error("proof module import failed");
      },
      onDiagnostic,
    });

    expect(result).toMatchObject({
      state: "failed",
      diagnostic: {
        kind: "import-error",
        message: "proof module import failed",
      },
    });
    expect(onDiagnostic).toHaveBeenCalledWith({
      kind: "import-error",
      message: "proof module import failed",
    });
    expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeNull();
    expect(normalApp).toBeInTheDocument();
  });

  it("removes a partial proof panel when mounting throws synchronously", async () => {
    const normalApp = document.createElement("main");
    normalApp.textContent = "Normal StreamFusion UI";
    document.body.appendChild(normalApp);
    const partialPanel = document.createElement("section");
    partialPanel.id = "twitch-ad-frame-proof-panel";
    document.body.appendChild(partialPanel);

    const result = await startTwitchAdFrameProof({
      runId: "adframe-20260803-r4",
      loadPanel: async () => ({
        mountTwitchAdFrameProofPanel: () => {
          throw new Error("proof panel mount failed");
        },
      }),
    });

    expect(result).toMatchObject({
      state: "failed",
      diagnostic: {
        kind: "mount-error",
        message: "proof panel mount failed",
      },
    });
    expect(document.getElementById("twitch-ad-frame-proof-panel")).toBeNull();
    expect(normalApp).toBeInTheDocument();
  });
});

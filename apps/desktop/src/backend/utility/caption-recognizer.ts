import path from "node:path";

import type { LocalCaptionPcmChunk } from "@/shared/local-caption-types";

import { LocalCaptionRecognizer } from "../services/captions/local-caption-recognizer";

interface ParentPort {
  on(event: "message", listener: (event: { data: UtilityInput }) => void): void;
  postMessage(message: unknown): void;
}

type UtilityInput =
  | { type: "start"; sessionId: string; generation: number; modelPath: string }
  | ({ type: "audio" } & LocalCaptionPcmChunk)
  | { type: "stop"; sessionId: string };

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("Local caption utility requires an Electron parent port");

let recognizer: LocalCaptionRecognizer | null = null;
let activeIdentity: { sessionId: string; generation: number } | null = null;

async function start(input: Extract<UtilityInput, { type: "start" }>): Promise<void> {
  const identity = { sessionId: input.sessionId, generation: input.generation };
  activeIdentity = identity;
  parentPort.postMessage({ type: "state", ...identity, phase: "starting" });
  try {
    const { OnlineRecognizer } = await import("sherpa-onnx-node");
    const sherpa = new OnlineRecognizer({
      featConfig: { sampleRate: 16_000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(input.modelPath, "encoder-epoch-99-avg-1.int8.onnx"),
          decoder: path.join(input.modelPath, "decoder-epoch-99-avg-1.onnx"),
          joiner: path.join(input.modelPath, "joiner-epoch-99-avg-1.int8.onnx"),
        },
        tokens: path.join(input.modelPath, "tokens.txt"),
        numThreads: 2,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
      maxActivePaths: 4,
      enableEndpoint: 1,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    });
    if (
      !activeIdentity ||
      activeIdentity.sessionId !== input.sessionId ||
      activeIdentity.generation !== input.generation
    ) {
      return;
    }
    recognizer = new LocalCaptionRecognizer(sherpa, (message) => parentPort.postMessage(message));
    recognizer.start(identity);
    parentPort.postMessage({ type: "state", ...identity, phase: "ready" });
  } catch (error) {
    recognizer = null;
    parentPort.postMessage({
      type: "state",
      ...identity,
      phase: "error",
      error: error instanceof Error ? error.message : "Local recognizer failed to start",
    });
  }
}

parentPort.on("message", ({ data }) => {
  if (data.type === "start") {
    void start(data);
    return;
  }
  if (data.type === "audio") {
    recognizer?.acceptAudio(data);
    return;
  }
  if (data.type === "stop" && data.sessionId === activeIdentity?.sessionId) {
    parentPort.postMessage({ type: "state", ...activeIdentity, phase: "stopped" });
    recognizer = null;
    activeIdentity = null;
  }
});

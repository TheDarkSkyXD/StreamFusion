import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

interface ProbeProcess {
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
}

export type StreamRecordingArtifactProbe = (input: {
  ffmpegPath: string;
  outputPath: string;
}) => Promise<boolean>;

export function createStreamRecordingArtifactProbe({
  spawnProcess = (command: string, args: string[]) =>
    spawn(command, args, { windowsHide: true, stdio: "ignore" }),
}: {
  spawnProcess?: (command: string, args: string[]) => ProbeProcess;
} = {}): StreamRecordingArtifactProbe {
  return async ({ ffmpegPath, outputPath }) => {
    try {
      if ((await stat(outputPath)).size === 0) return false;
    } catch {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const child = spawnProcess(ffmpegPath, [
        "-v",
        "error",
        "-nostdin",
        "-i",
        outputPath,
        "-t",
        "0.1",
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-f",
        "null",
        "-",
      ]);
      let settled = false;
      child.on("error", () => {
        if (!settled) resolve(false);
        settled = true;
      });
      child.on("close", (code) => {
        if (!settled) resolve(code === 0);
        settled = true;
      });
    });
  };
}

const PROOF_PATH = "/__streamfusion-proof/twitch-ad-frame";
const PROOF_TARGET = "http://127.0.0.1:18765";

interface TwitchAdFrameProofConfigInput {
  command: "build" | "serve";
  mode: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

interface TwitchAdFrameProofProxy {
  target: typeof PROOF_TARGET;
  changeOrigin: false;
  rewrite: (path: string) => string;
}

export type TwitchAdFrameProofConfig =
  | { enabled: false }
  | {
      enabled: true;
      prefix: string;
      proxy: TwitchAdFrameProofProxy;
    };

export function createTwitchAdFrameProofConfig({
  command,
  mode,
  env,
}: TwitchAdFrameProofConfigInput): TwitchAdFrameProofConfig {
  const runId = env.STREAMFUSION_TWITCH_AD_FRAME_PROOF;
  if (command !== "serve" || mode !== "development" || !runId) {
    return { enabled: false };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error("Twitch ad-frame proof requires a valid run ID");
  }
  const prefix = `${PROOF_PATH}/${runId}/`;

  return {
    enabled: true,
    prefix,
    proxy: {
      target: PROOF_TARGET,
      changeOrigin: false,
      rewrite: (path) => {
        return path.startsWith(prefix) ? `/${path.slice(prefix.length)}` : path;
      },
    },
  };
}

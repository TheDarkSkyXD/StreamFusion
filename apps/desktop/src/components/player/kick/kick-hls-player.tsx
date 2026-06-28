import { forwardRef, useMemo } from "react";

import { type HlsConfigOverrides, HlsPlayer, type HlsPlayerProps } from "../hls-player";

import { resolveKickHlsConfig } from "./kick-hls-config";

export type KickHlsPlayerProps = Omit<HlsPlayerProps, "hlsConfig">;

export const KickHlsPlayer = forwardRef<HTMLVideoElement, KickHlsPlayerProps>((props, ref) => {
  const { src } = props;
  const hlsConfig = useMemo<HlsConfigOverrides | undefined>(() => resolveKickHlsConfig(src), [src]);

  return <HlsPlayer ref={ref} {...props} hlsConfig={hlsConfig} />;
});

KickHlsPlayer.displayName = "KickHlsPlayer";

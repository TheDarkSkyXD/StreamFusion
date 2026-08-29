import { forwardRef } from "react";

import { HlsPlayer, type HlsPlayerProps } from "../hls-player";

export type TwitchVodHlsPlayerProps = HlsPlayerProps;

export const TwitchVodHlsPlayer = forwardRef<HTMLVideoElement, TwitchVodHlsPlayerProps>(
  (props, ref) => <HlsPlayer ref={ref} {...props} />
);

TwitchVodHlsPlayer.displayName = "TwitchVodHlsPlayer";

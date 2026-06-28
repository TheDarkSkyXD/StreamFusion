import { PlayerControls, type PlayerControlsProps } from "../player-controls";

import { KickProgressBar } from "./kick-progress-bar";

type KickVodPlayerControlsProps = PlayerControlsProps;

export function KickVodPlayerControls(props: KickVodPlayerControlsProps) {
  return (
    <PlayerControls
      {...props}
      theaterActiveColor="#53fc18"
      progressBar={
        <KickProgressBar
          currentTime={props.currentTime ?? 0}
          duration={props.duration ?? 0}
          onSeek={props.onSeek ?? (() => {})}
          buffered={props.buffered}
          onSeekHover={props.onSeekHover}
          previewImage={props.previewImage}
        />
      }
    />
  );
}

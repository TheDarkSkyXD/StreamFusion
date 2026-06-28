import { PlayerControls, type PlayerControlsProps } from "../player-controls";

import { TwitchProgressBar } from "./twitch-progress-bar";

type TwitchVodPlayerControlsProps = PlayerControlsProps;

export function TwitchVodPlayerControls(props: TwitchVodPlayerControlsProps) {
  return (
    <PlayerControls
      {...props}
      theaterActiveColor="#9146ff"
      progressBar={
        <TwitchProgressBar
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

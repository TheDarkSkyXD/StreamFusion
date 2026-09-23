import type {
  MiniPlayerSnapRegion,
  PictureInPicturePhase,
  PlayerPresentation,
  PlayerPresentationState,
} from "../capabilities/watch";

export type {
  MiniPlayerSnapRegion,
  PictureInPicturePhase,
  PlayerPresentation,
  PlayerPresentationState,
};

export const INITIAL_PLAYER_PRESENTATION: PlayerPresentationState = {
  pip: "idle",
  presentation: "watch",
  previous: null,
  snapRegion: "bottom-end",
};

export function concealFromWatch(
  state: PlayerPresentationState,
): PlayerPresentationState {
  if (state.presentation === "pip" || state.pip === "active") {
    return state;
  }
  if (state.presentation === "mini") return state;
  return {
    ...state,
    presentation: "mini",
    previous: state.presentation,
  };
}

export function revealInWatch(
  state: PlayerPresentationState,
): PlayerPresentationState {
  if (state.pip === "active") {
    return { ...state, presentation: "pip", previous: "watch" };
  }
  if (state.presentation === "watch") return state;
  return {
    ...state,
    pip: state.pip === "returned" ? "idle" : state.pip,
    presentation: "watch",
    previous: null,
  };
}

export function enterFullscreen(
  state: PlayerPresentationState,
): PlayerPresentationState {
  if (state.presentation === "pip") return state;
  return {
    ...state,
    presentation: "fullscreen",
    previous:
      state.presentation === "fullscreen" ? state.previous : state.presentation,
  };
}

export function exitFullscreen(
  state: PlayerPresentationState,
): PlayerPresentationState {
  if (state.presentation !== "fullscreen") return state;
  return {
    ...state,
    presentation: state.previous === "mini" ? "mini" : "watch",
    previous: null,
  };
}

export function requestPictureInPicture(
  state: PlayerPresentationState,
): PlayerPresentationState {
  const previous =
    state.presentation === "pip"
      ? state.previous
      : state.presentation === "fullscreen"
        ? "watch"
        : state.presentation;
  return {
    ...state,
    pip: "requesting",
    presentation: "pip",
    previous,
  };
}

export function applyPictureInPictureResult(
  state: PlayerPresentationState,
  result: Extract<
    PictureInPicturePhase,
    "active" | "unavailable" | "failed"
  >,
): PlayerPresentationState {
  if (result === "active") {
    return { ...state, pip: "active", presentation: "pip" };
  }
  const restored = state.previous ?? "watch";
  return {
    ...state,
    pip: result,
    presentation: restored,
    previous: null,
  };
}

export function returnFromPictureInPicture(
  state: PlayerPresentationState,
): PlayerPresentationState {
  const restored = state.previous ?? "watch";
  return {
    ...state,
    pip: "returned",
    presentation: restored,
    previous: null,
  };
}

export function relocateMiniPlayer(
  state: PlayerPresentationState,
  snapRegion: MiniPlayerSnapRegion,
): PlayerPresentationState {
  if (state.presentation !== "mini") return state;
  return { ...state, snapRegion };
}

const PIP_STATUS_COPY: Record<PictureInPicturePhase, string | null> = {
  idle: null,
  requesting: "Picture-in-Picture is requesting. One Watch session continues.",
  active:
    "Picture-in-Picture is active. Watch, mini-player, and PiP share one session with no duplicate audio.",
  unavailable: "Picture-in-Picture is unavailable on this device.",
  failed: "Picture-in-Picture failed. Playback continues in the previous presentation.",
  returned: "Returned from Picture-in-Picture. The same Watch session is restored.",
};

export const FULLSCREEN_LIFECYCLE_COPY =
  "Fullscreen is an in-app overlay that unlocks landscape left and right. Hardware Back restores the previous presentation and portrait. Unsupported orientation lock is left unchanged.";

export function isPictureInPictureSurface(
  state: PlayerPresentationState,
): boolean {
  return (
    state.presentation === "pip" ||
    state.pip === "requesting" ||
    state.pip === "active"
  );
}

export function pictureInPictureStatusCopy(
  phase: PictureInPicturePhase,
): string | null {
  return PIP_STATUS_COPY[phase];
}

export function miniPlayerSnapStyle(
  region: MiniPlayerSnapRegion,
  inset: { readonly bottom: number; readonly top: number },
): {
  readonly bottom?: number;
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
} {
  const edge = 8;
  if (region === "top-start") {
    return { left: edge, top: inset.top + edge };
  }
  if (region === "top-end") {
    return { right: edge, top: inset.top + edge };
  }
  if (region === "bottom-start") {
    return { bottom: inset.bottom + edge, left: edge };
  }
  return { bottom: inset.bottom + edge, right: edge };
}

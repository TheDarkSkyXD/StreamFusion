import { describe, expect, it } from "vitest";

import {
  INITIAL_PLAYER_PRESENTATION,
  applyPictureInPictureResult,
  concealFromWatch,
  enterFullscreen,
  exitFullscreen,
  FULLSCREEN_LIFECYCLE_COPY,
  isPictureInPictureSurface,
  miniPlayerSnapStyle,
  pictureInPictureStatusCopy,
  relocateMiniPlayer,
  requestPictureInPicture,
  returnFromPictureInPicture,
  revealInWatch,
} from "../domain/player-presentation";

describe("player presentation", () => {
  it("conceals focused Watch into the mini-player without duplicating PiP", () => {
    const mini = concealFromWatch(INITIAL_PLAYER_PRESENTATION);
    expect(mini).toMatchObject({ presentation: "mini", previous: "watch" });
    const pip = requestPictureInPicture(mini);
    expect(concealFromWatch(pip).presentation).toBe("pip");
  });

  it("keeps one session across fullscreen, PiP, and return", () => {
    const fullscreen = enterFullscreen(INITIAL_PLAYER_PRESENTATION);
    expect(fullscreen.presentation).toBe("fullscreen");
    const requesting = requestPictureInPicture(fullscreen);
    expect(requesting).toMatchObject({
      pip: "requesting",
      presentation: "pip",
      previous: "watch",
    });
    const active = applyPictureInPictureResult(requesting, "active");
    expect(active.presentation).toBe("pip");
    expect(returnFromPictureInPicture(active)).toMatchObject({
      pip: "returned",
      presentation: "watch",
    });
  });

  it("restores Watch when PiP is unavailable and relocates the mini-player to named snaps", () => {
    const failed = applyPictureInPictureResult(
      requestPictureInPicture(INITIAL_PLAYER_PRESENTATION),
      "unavailable",
    );
    expect(failed).toMatchObject({
      pip: "unavailable",
      presentation: "watch",
    });
    const mini = concealFromWatch(failed);
    const moved = relocateMiniPlayer(mini, "top-start");
    expect(moved.snapRegion).toBe("top-start");
    expect(miniPlayerSnapStyle(moved.snapRegion, { bottom: 12, top: 24 })).toEqual(
      { left: 8, top: 32 },
    );
    expect(exitFullscreen(enterFullscreen(mini)).presentation).toBe("mini");
    expect(revealInWatch(moved).presentation).toBe("watch");
    const returned = returnFromPictureInPicture(
      applyPictureInPictureResult(
        requestPictureInPicture(INITIAL_PLAYER_PRESENTATION),
        "active",
      ),
    );
    expect(revealInWatch(returned)).toMatchObject({
      pip: "returned",
      presentation: "watch",
    });
  });

  it("names every PiP phase and fullscreen restoration copy", () => {
    expect(pictureInPictureStatusCopy("idle")).toBeNull();
    expect(pictureInPictureStatusCopy("requesting")).toContain("requesting");
    expect(pictureInPictureStatusCopy("active")).toContain("no duplicate audio");
    expect(pictureInPictureStatusCopy("unavailable")).toContain("unavailable");
    expect(pictureInPictureStatusCopy("failed")).toContain("failed");
    expect(pictureInPictureStatusCopy("returned")).toContain("Returned");
    expect(FULLSCREEN_LIFECYCLE_COPY).toContain("Hardware Back");
    expect(FULLSCREEN_LIFECYCLE_COPY).toContain("landscape left and right");
    expect(FULLSCREEN_LIFECYCLE_COPY).toContain("portrait");
    expect(isPictureInPictureSurface(requestPictureInPicture(INITIAL_PLAYER_PRESENTATION))).toBe(
      true,
    );
    expect(isPictureInPictureSurface(INITIAL_PLAYER_PRESENTATION)).toBe(false);
  });
});

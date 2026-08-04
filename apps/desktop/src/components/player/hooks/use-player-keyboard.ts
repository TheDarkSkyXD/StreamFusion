import { useEffect } from "react";

interface UsePlayerKeyboardProps {
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onToggleFullscreen: () => void;
  onToggleTheater?: () => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
  disabled?: boolean;
}

export function usePlayerKeyboard({
  onTogglePlay,
  onToggleMute,
  onVolumeUp,
  onVolumeDown,
  onToggleFullscreen,
  onToggleTheater,
  onSeekBackward,
  onSeekForward,
  disabled = false,
}: UsePlayerKeyboardProps) {
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, button, a[href], [role="button"], [role="link"], [contenteditable="true"]'
          ))
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "k":
        case " ":
          e.preventDefault();
          onTogglePlay();
          break;
        case "m":
          e.preventDefault();
          onToggleMute();
          break;
        case "f":
          e.preventDefault();
          onToggleFullscreen();
          break;
        case "t":
          if (onToggleTheater) {
            e.preventDefault();
            onToggleTheater();
          }
          break;
        case "arrowup":
          e.preventDefault();
          onVolumeUp();
          break;
        case "arrowdown":
          e.preventDefault();
          onVolumeDown();
          break;
        case "arrowleft":
          if (onSeekBackward) {
            e.preventDefault();
            onSeekBackward();
          }
          break;
        case "arrowright":
          if (onSeekForward) {
            e.preventDefault();
            onSeekForward();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    disabled,
    onTogglePlay,
    onToggleMute,
    onVolumeUp,
    onVolumeDown,
    onToggleFullscreen,
    onToggleTheater,
    onSeekBackward,
    onSeekForward,
  ]);
}

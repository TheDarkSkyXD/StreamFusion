import { LuPause, LuPlay } from "react-icons/lu";

import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface PlayPauseButtonProps {
  isPlaying: boolean;
  isLoading?: boolean;
  onToggle: () => void;
  className?: string;
}

export function PlayPauseButton({
  isPlaying,
  isLoading,
  onToggle,
  className,
}: PlayPauseButtonProps) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`text-white hover:bg-white/20 rounded-full select-none cursor-pointer ${className || ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {isPlaying ? (
            <LuPause className="w-6 h-6 fill-current" />
          ) : (
            <LuPlay className="w-6 h-6 fill-current" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{isPlaying ? "Pause (Space)" : "Play (Space)"}</p>
      </TooltipContent>
    </Tooltip>
  );
}

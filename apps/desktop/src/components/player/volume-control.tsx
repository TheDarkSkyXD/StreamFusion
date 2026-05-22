import { useRef, useState } from "react";
import { LuVolume1, LuVolume2, LuVolumeX } from "react-icons/lu";

import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface VolumeControlProps {
  volume: number; // 0 to 100
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
  className?: string;
}

export function VolumeControl({
  volume,
  muted,
  onVolumeChange,
  onMuteToggle,
  className,
}: VolumeControlProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  // Keep the thumb Tooltip fully controlled — mixing `open={isDragging || undefined}`
  // flips Radix between controlled (true) and uncontrolled (undefined) modes
  // every drag cycle, which logs the "controlled to uncontrolled" warning.
  const [thumbTooltipOpen, setThumbTooltipOpen] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  const getIcon = () => {
    if (muted || volume === 0) return <LuVolumeX className="w-6 h-6 fill-current" />;
    if (volume < 50) return <LuVolume1 className="w-6 h-6 fill-current" />;
    return <LuVolume2 className="w-6 h-6 fill-current" />;
  };

  const displayVolume = muted ? 0 : volume;

  // Dynamic tooltip text based on mute state
  const getMuteTooltipText = () => {
    return muted ? "Unmute (m)" : "Mute (m)";
  };

  return (
    <div
      className={`flex items-center group/volume ${className || ""}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => !isDragging && setIsHovering(false)}
    >
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 rounded-full select-none z-10 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onMuteToggle();
            }}
          >
            {getIcon()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getMuteTooltipText()}</p>
        </TooltipContent>
      </Tooltip>

      <div
        className={`
                flex items-center overflow-hidden transition-all duration-200 ease-in-out
                ${isHovering || isDragging ? "w-24 opacity-100 ml-2" : "w-0 opacity-0"}
            `}
      >
        {/* Custom slider with visible thumb and drag support */}
        <div
          ref={sliderRef}
          className="relative w-full h-4 flex items-center cursor-pointer select-none"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsDragging(true);
            const rect = e.currentTarget.getBoundingClientRect();
            const percent = Math.max(
              0,
              Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)
            );
            onVolumeChange(percent);

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const movePercent = Math.max(
                0,
                Math.min(100, ((moveEvent.clientX - rect.left) / rect.width) * 100)
              );
              onVolumeChange(movePercent);
            };

            const handleMouseUp = () => {
              setIsDragging(false);
              setIsHovering(false);
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
        >
          {/* Track background */}
          <div className="absolute w-full h-1 bg-white/30 rounded-full" />
          {/* Filled track */}
          <div
            className="absolute h-1 bg-white rounded-full"
            style={{ width: `${displayVolume}%` }}
          />
          {/* Thumb (white circle) - positioned to stay within bounds */}
          <Tooltip
            delayDuration={0}
            open={isDragging || thumbTooltipOpen}
            onOpenChange={setThumbTooltipOpen}
          >
            <TooltipTrigger asChild>
              <div
                className="absolute w-4 h-4 bg-white rounded-full shadow-md cursor-pointer"
                style={{
                  left: `calc(${displayVolume / 100} * (100% - 16px))`,
                }}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{Math.round(displayVolume)}%</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

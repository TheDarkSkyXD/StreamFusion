import React from "react";

import { cn, formatDuration } from "@/lib/utils";

interface SeekPreviewProps {
  time: number;
  position: number; // 0 to 1 representing the horizontal position on the progress bar
  previewImage?: string; // Optional URL for video frame preview
  className?: string;
}

export function SeekPreview({ time, position, previewImage, className }: SeekPreviewProps) {
  // Prevent overflow at edges (adjust thresholds based on preview width)
  const isNearLeftEdge = position < 0.1;
  const isNearRightEdge = position > 0.9;
  const [failedImage, setFailedImage] = React.useState<string | null>(null);
  const imageError = previewImage === failedImage;

  return (
    <div
      className={cn(
        "absolute bottom-full mb-3 flex flex-col items-center pointer-events-none z-50",
        isNearLeftEdge ? "left-0" : isNearRightEdge ? "right-0 translate-x-0" : "-translate-x-1/2",
        className
      )}
      style={isNearLeftEdge || isNearRightEdge ? undefined : { left: `${position * 100}%` }}
    >
      {/* Thumbnail Preview (if available) */}
      {previewImage && (
        <div className="mb-1.5 p-0.5 bg-black/90 rounded-md border border-white/10 shadow-2xl overflow-hidden">
          <div className="relative w-40 aspect-video bg-zinc-900">
            {!imageError ? (
              <img
                src={previewImage}
                alt={`Preview at ${formatDuration(time)}`}
                className="w-full h-full object-cover"
                onError={() => setFailedImage(previewImage)}
              />
            ) : (
              <div className="flex items-center justify-center w-full h-full text-white/50 text-xs">
                Preview unavailable
              </div>
            )}
          </div>
        </div>
      )}

      {/* Time Display */}
      <div className="relative flex flex-col items-center">
        <div className="bg-black/90 backdrop-blur-sm text-white text-[11px] font-bold px-2 py-1 rounded border border-white/10 shadow-lg whitespace-nowrap min-w-[40px] text-center">
          {formatDuration(time)}
        </div>
        {/* Small caret arrow pointing down to the bar */}
        <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-black/90 -mt-[1px]" />
      </div>
    </div>
  );
}

/**
 * EmoteImage Component - Performance Optimized
 *
 * Renders emotes with proper sizing, lazy loading, and error handling.
 * Supports animated emotes and zero-width overlays.
 *
 * Performance optimizations:
 * - React.memo to prevent re-renders when props haven't changed
 * - useMemo for URL calculation
 * - useCallback for event handlers
 */

import type React from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { Emote } from "../../backend/services/emotes/emote-types";
import { EmoteTooltip } from "./tooltips/EmoteTooltip";

/** Size presets for emotes */
type EmoteSize = "small" | "medium" | "large" | "xlarge";

interface EmoteImageProps {
  /** Emote data object */
  emote: Emote;
  /** Size preset */
  size?: EmoteSize;
  /** Custom class name */
  className?: string;
  /** Whether to show tooltip on hover */
  showTooltip?: boolean;
  /** Callback when emote is clicked */
  onClick?: (emote: Emote) => void;
  /** Whether to lazy load the image */
  lazyLoad?: boolean;
}

/** Size configurations in pixels */
const SIZE_CONFIG: Record<EmoteSize, { height: number; urlSize: "1x" | "2x" | "4x" }> = {
  small: { height: 20, urlSize: "1x" },
  medium: { height: 28, urlSize: "2x" },
  large: { height: 48, urlSize: "2x" },
  xlarge: { height: 64, urlSize: "4x" },
};

export const EmoteImage: React.FC<EmoteImageProps> = memo(
  ({ emote, size = "medium", className = "", showTooltip = true, onClick, lazyLoad = true }) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);

    // Tooltip state
    const [showTooltipState, setShowTooltipState] = useState(false);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

    const imgRef = useRef<HTMLImageElement>(null);

    const config = SIZE_CONFIG[size];

    // Memoize URL calculation
    const url = useMemo(() => {
      switch (config.urlSize) {
        case "1x":
          return emote.urls.url1x;
        case "2x":
          return emote.urls.url2x;
        case "4x":
          return emote.urls.url4x || emote.urls.url2x;
        default:
          return emote.urls.url2x;
      }
    }, [config.urlSize, emote.urls.url1x, emote.urls.url2x, emote.urls.url4x]);

    const handleLoad = useCallback(() => {
      setIsLoaded(true);
      setHasError(false);
    }, []);

    const handleError = useCallback(() => {
      setHasError(true);
      setIsLoaded(true);
    }, []);

    const handleClick = useCallback(() => {
      if (onClick) {
        onClick(emote);
      }
    }, [onClick, emote]);

    // Capture position once on hover-enter — tooltip is anchored, doesn't follow the cursor.
    // Previously onMouseMove fired ~60 Hz allocating a fresh {x,y} object per frame.
    const handleMouseEnter = useCallback(
      (e: React.MouseEvent) => {
        if (showTooltip) {
          setMousePos({ x: e.clientX, y: e.clientY });
          setShowTooltipState(true);
        }
      },
      [showTooltip]
    );

    const handleMouseLeave = useCallback(() => {
      setShowTooltipState(false);
    }, []);

    // Zero-width emotes need special positioning
    const zeroWidthStyles: React.CSSProperties = emote.isZeroWidth
      ? {
          position: "absolute",
          marginLeft: `-${config.height}px`,
        }
      : {};

    if (hasError) {
      // Fallback for broken images - show emote code
      return (
        <span
          className={`inline-flex items-center justify-center bg-gray-700 rounded px-1 text-xs ${className}`}
          style={{ height: config.height }}
          title={`${emote.name} (${emote.provider})`}
        >
          {emote.name}
        </span>
      );
    }

    return (
      <>
        <span
          className={`relative inline-flex items-center ${onClick ? "cursor-pointer" : ""} ${className}`}
          style={zeroWidthStyles}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        >
          {/* Loading skeleton */}
          {!isLoaded && (
            <span
              className="inline-block bg-gray-700 rounded animate-pulse"
              style={{ width: config.height, height: config.height }}
            />
          )}

          {/* Actual emote image */}
          <img
            ref={imgRef}
            src={url}
            alt={emote.name}
            loading={lazyLoad ? "lazy" : "eager"}
            onLoad={handleLoad}
            onError={handleError}
            className={`inline-block align-middle transition-opacity duration-200 ${
              isLoaded ? "opacity-100" : "opacity-0"
            }`}
            style={{
              height: config.height,
              width: "auto",
              position: isLoaded ? "relative" : "absolute",
            }}
            draggable={false}
          />
        </span>

        <EmoteTooltip show={showTooltipState} mousePos={mousePos} emote={emote} />
      </>
    );
  }
);

EmoteImage.displayName = "EmoteImage";

export default EmoteImage;

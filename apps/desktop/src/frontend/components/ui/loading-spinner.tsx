interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  color?: string;
  className?: string;
}

/**
 * Animated loading spinner component
 * Uses inline styles for reliable color rendering
 */
export function LoadingSpinner({
  size = "lg",
  color = "#ffffff",
  className = "",
}: LoadingSpinnerProps) {
  const sizeMap = {
    sm: { width: 24, height: 24, border: 3 },
    md: { width: 40, height: 40, border: 4 },
    lg: { width: 48, height: 48, border: 4 },
  };

  const { width, height, border } = sizeMap[size];

  // Convert hex to rgba for the track color (30% opacity)
  const trackColor = `${color}4D`; // 4D = ~30% in hex

  return (
    <div
      className={`animate-spin ${className}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: "50%",
        border: `${border}px solid ${trackColor}`,
        borderTopColor: color,
      }}
    />
  );
}

// Platform-specific convenience components
export function KickLoadingSpinner({ size = "lg" }: { size?: "sm" | "md" | "lg" }) {
  return <LoadingSpinner size={size} color="#53fc18" />;
}

export function TwitchLoadingSpinner({ size = "lg" }: { size?: "sm" | "md" | "lg" }) {
  return <LoadingSpinner size={size} color="#9146ff" />;
}

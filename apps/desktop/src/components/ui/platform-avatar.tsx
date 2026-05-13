import { ProxiedImage } from "@/components/ui/proxied-image";
import { cn } from "@/lib/utils";

interface PlatformAvatarProps {
  src?: string | null;
  alt: string;
  platform: "twitch" | "kick";
  size?: string; // e.g., "w-10 h-10" or "w-16 h-16"
  className?: string;
  isLive?: boolean;
  liveStatusType?: "dot" | "badge";
  disablePlatformBorder?: boolean;
}

export function PlatformAvatar({
  src,
  alt,
  platform,
  size = "w-10 h-10",
  className,
  isLive = false,
  liveStatusType = "dot",
  disablePlatformBorder = false,
}: PlatformAvatarProps) {
  const isLarge = size.includes("w-16") || size.includes("w-20") || size.includes("w-24");
  const badgeOffset = isLarge ? "-bottom-1 -right-1" : "-bottom-0.5 -right-0.5";

  return (
    <div className={cn("relative shrink-0 rounded-full", size, className)}>
      <div
        className={cn(
          "w-full h-full rounded-full",
          !disablePlatformBorder && "p-0.5",
          !disablePlatformBorder && (platform === "twitch" ? "bg-[#9146FF]" : "bg-[#53FC18]")
        )}
      >
        <ProxiedImage
          src={src}
          alt={alt}
          className={cn(
            "w-full h-full rounded-full object-cover",
            "bg-[var(--color-background-tertiary)]", // Background while loading
            !disablePlatformBorder && "border-2 border-[var(--color-background)]" // Inner border to separate image from platform color
          )}
          fallback={
            <div
              className={cn(
                "w-full h-full rounded-full flex items-center justify-center",
                "bg-[var(--color-background-tertiary)] border-2 border-[var(--color-background)]"
              )}
            >
              <span
                className="font-bold text-[var(--color-foreground-muted)] uppercase select-none"
                style={{ fontSize: "120%" }}
              >
                {(alt || "?").slice(0, 1)}
              </span>
            </div>
          }
        />
      </div>

      {isLive &&
        (liveStatusType === "badge" ? (
          <div
            className={cn(
              "absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded border-[3px] flex items-center justify-center font-bold px-1.5 py-0.5 text-[10px] leading-none",
              platform === "twitch"
                ? "bg-[#9146FF] text-white border-[var(--color-background)]"
                : "bg-[#53FC18] text-black !border-[#53FC18]"
            )}
          >
            LIVE
          </div>
        ) : (
          <div
            className={cn(
              "absolute bg-red-500 rounded-full border-[2px] border-[var(--color-background)]",
              badgeOffset,
              isLarge ? "w-4 h-4" : "w-3 h-3"
            )}
          />
        ))}
    </div>
  );
}

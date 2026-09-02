import { useTranslation } from "react-i18next";
import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface BadgeTooltipProps {
  show: boolean;
  mousePos: { x: number; y: number } | null;
  badgeInfo: {
    src: string;
    title: string;
    platform?: string;
    owner?: { username: string };
  } | null;
}

export const BadgeTooltip: React.FC<BadgeTooltipProps> = ({ show, mousePos, badgeInfo }) => {
  const { t } = useTranslation();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ top: number; left: number; opacity: number }>({
    top: 0,
    left: 0,
    opacity: 0,
  });

  useLayoutEffect(() => {
    if (!mousePos || !show || !badgeInfo || !tooltipRef.current) {
      if (style.opacity !== 0) {
        setStyle((prev) => ({ ...prev, opacity: 0 }));
      }
      return;
    }

    const calculatePosition = () => {
      const offset = 10;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Measure actual dimensions
      const rect = tooltipRef.current?.getBoundingClientRect();
      const width = rect?.width || 200;
      const height = rect?.height || 180;

      let top = mousePos.y + offset;
      let left = mousePos.x + offset;

      // Prevent going off right edge
      if (left + width > windowWidth - 20) {
        left = mousePos.x - width - offset;
      }
      if (left < 20) {
        left = windowWidth - width - 20;
      }

      // Prevent going off bottom edge
      if (top + height > windowHeight - 20) {
        top = mousePos.y - height - offset;
      }
      if (top < 20) {
        top = 20;
      }

      // Apply final position and show
      setStyle({ top, left, opacity: 1 });
    };

    calculatePosition();
  }, [mousePos, show, badgeInfo, style.opacity]); // Added style.opacity to dependencies to re-run when opacity changes

  if (!show || !badgeInfo || !mousePos) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        top: style.top,
        left: style.left,
        opacity: style.opacity,
        position: "fixed",
        zIndex: 9999,
        transition: "opacity 0.1s ease-out",
      }}
      className="pointer-events-none flex flex-col items-center bg-[#0b0c0f] border border-white/10 rounded-lg p-4 shadow-2xl min-w-[200px]"
    >
      {/* Badge Icon - Large */}
      <div className="mb-3">
        <img
          src={badgeInfo.src}
          alt={badgeInfo.title}
          className="w-16 h-16 object-contain drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]"
        />
      </div>

      {/* Content */}
      <div className="flex flex-col items-center w-full gap-3">
        <span className="text-white font-extrabold text-lg leading-tight text-center">
          {badgeInfo.title}
        </span>

        {/* Platform Badge - Consistent with EmoteTooltip style */}
        <div className="w-full bg-[#1e1f23] border border-white/10 rounded px-4 py-1.5 text-center">
          <span className="text-[#b0b3b8] font-bold text-sm">
            {badgeInfo.platform || t("chat.system")}
          </span>
        </div>
      </div>

      {badgeInfo.owner && (
        <span className="mt-3 text-xs text-neutral-500">
          {t("chat.createdBy")}{" "}
          <span className="text-white hover:underline cursor-pointer">
            {badgeInfo.owner.username}
          </span>
        </span>
      )}
    </div>,
    document.body
  );
};

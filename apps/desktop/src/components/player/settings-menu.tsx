import React, { useMemo, useState } from "react";
import { IoMdSettings } from "react-icons/io";
import {
  LuActivity,
  LuCheck,
  LuChevronLeft,
  LuChevronRight,
  LuFileText,
  LuSlidersHorizontal,
  LuTimer,
} from "react-icons/lu";

import { DEFAULT_PLAYER_CONTROLS_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

import type { QualityLevel } from "./types";

export interface SettingsMenuProps {
  qualities: QualityLevel[];
  currentQualityId: string;
  onQualityChange: (qualityId: string) => void;
  onTogglePip?: () => void;
  onToggleTheater?: () => void;
  isTheater?: boolean;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  onOpenChange?: (isOpen: boolean) => void;
  showVideoStats?: boolean;
  onToggleVideoStats?: () => void;
  container?: HTMLElement | null;
}

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function SettingsMenu({
  qualities,
  currentQualityId,
  onQualityChange,
  onTogglePip,
  onToggleTheater,
  isTheater,
  playbackRate = 1,
  onPlaybackRateChange,
  onOpenChange,
  showVideoStats = false,
  onToggleVideoStats,
  container,
}: SettingsMenuProps) {
  const controls =
    useAuthStore((s) => s.preferences?.playerControls) ?? DEFAULT_PLAYER_CONTROLS_PREFERENCES;

  const [isOpen, setIsOpen] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<"main" | "quality" | "speed">("main");

  // Notify parent of open state changes
  React.useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  const toggleOpen = () => {
    setIsOpen(!isOpen);
    setActiveSubMenu("main");
  };

  const sortedQualities = useMemo(() => {
    return [...qualities].sort((a, b) => {
      // Auto always at bottom
      if (a.isAuto) return 1;
      if (b.isAuto) return -1;

      // Sort by height descending
      if (a.height !== b.height) return b.height - a.height;

      // Then by bitrate descending
      return b.bitrate - a.bitrate;
    });
  }, [qualities]);

  const currentQualityLabel = qualities.find((q) => q.id === currentQualityId)?.label || "Auto";

  return (
    <div className="relative">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 cursor-pointer w-10 h-10"
            onClick={(e) => {
              e.stopPropagation();
              toggleOpen();
            }}
          >
            <IoMdSettings
              className={`w-8 h-8 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent container={container}>
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>

      {isOpen && (
        <>
          {/* Backdrop to close */}
          <div className="fixed inset-0 z-50" onClick={() => setIsOpen(false)} />

          <div className="absolute bottom-16 right-0 min-w-[300px] bg-[rgba(28,28,28,0.95)] backdrop-blur-sm rounded-[12px] overflow-hidden z-[60] animate-in fade-in slide-in-from-bottom-2 duration-200 py-2 shadow-[0_4px_32px_0_rgba(0,0,0,0.5)]">
            {activeSubMenu === "main" && (
              <div className="flex flex-col">
                {/* Quality Menu Item */}
                {controls.showQuality && (
                  <button
                    className="w-full px-4 h-12 flex items-center justify-between hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium"
                    onClick={() => setActiveSubMenu("quality")}
                  >
                    <div className="flex items-center gap-4">
                      <LuSlidersHorizontal className="w-6 h-6" />
                      <span>Quality</span>
                    </div>
                    <div className="flex items-center text-[#aaaaaa] gap-1">
                      <span className="text-[13px]">{currentQualityLabel}</span>
                      <LuChevronRight className="w-5 h-5" />
                    </div>
                  </button>
                )}

                {/* Speed Menu Item */}
                {controls.showPlaybackSpeed && onPlaybackRateChange && (
                  <button
                    className="w-full px-4 h-12 flex items-center justify-between hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium"
                    onClick={() => setActiveSubMenu("speed")}
                  >
                    <div className="flex items-center gap-4">
                      <LuTimer className="w-6 h-6" />
                      <span>Playback speed</span>
                    </div>
                    <div className="flex items-center text-[#aaaaaa] gap-1">
                      <span className="text-[13px]">
                        {playbackRate === 1 ? "Normal" : `${playbackRate}x`}
                      </span>
                      <LuChevronRight className="w-5 h-5" />
                    </div>
                  </button>
                )}

                {/* Subtitles Placeholder (for visual completeness if requested, but logic absent) */}
                <button
                  className="w-full px-4 h-12 flex items-center justify-between hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium opacity-50 cursor-not-allowed"
                  disabled
                >
                  <div className="flex items-center gap-4">
                    <LuFileText className="w-6 h-6" />
                    <span>Subtitles/CC</span>
                  </div>
                  <div className="flex items-center text-[#aaaaaa] gap-1">
                    <span className="text-[13px]">Off</span>
                    <LuChevronRight className="w-5 h-5" />
                  </div>
                </button>

                {controls.showVideoStats && onToggleVideoStats && (
                  <div
                    className="w-full px-4 h-12 flex items-center justify-between hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium cursor-pointer"
                    onClick={() => onToggleVideoStats()}
                  >
                    <div className="flex items-center gap-4">
                      <LuActivity className="w-6 h-6" />
                      <span>Video Stats</span>
                    </div>
                    <Switch
                      checked={showVideoStats}
                      onCheckedChange={() => onToggleVideoStats()}
                      className="data-[state=checked]:!bg-[#3ea6ff] data-[state=unchecked]:!bg-[#ffffff4d] border-none h-[14px] w-[36px]"
                      thumbClassName="bg-[#f1f1f1] w-[20px] h-[20px] shadow-sm data-[state=checked]:translate-x-[19px] translate-x-[-3px]"
                    />
                  </div>
                )}
              </div>
            )}

            {activeSubMenu === "quality" && (
              <div>
                <button
                  className="w-full px-3 h-12 flex items-center gap-3 hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium border-b border-[#ffffff1a] mb-1"
                  onClick={() => setActiveSubMenu("main")}
                >
                  <LuChevronLeft className="w-7 h-7 text-[#eee]" />
                  <span>Quality</span>
                </button>
                <div className="max-h-80 overflow-y-auto custom-scrollbar">
                  {sortedQualities.map((quality) => (
                    <button
                      key={quality.id}
                      className="w-full px-4 h-12 flex items-center gap-4 hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[14px] text-[#eee]"
                      onClick={() => {
                        onQualityChange(quality.id);
                        setIsOpen(false);
                      }}
                    >
                      {currentQualityId === quality.id ? (
                        <LuCheck className="w-5 h-5 text-[#3ea6ff]" /> // YouTube selection is often blue or white
                      ) : (
                        <div className="w-5 h-5" />
                      )}
                      <span>{quality.label}</span>
                      {quality.isAuto && <span className="text-xs text-[#aaaaaa] ml-2"></span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeSubMenu === "speed" && onPlaybackRateChange && (
              <div>
                <button
                  className="w-full px-3 h-12 flex items-center gap-3 hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium border-b border-[#ffffff1a] mb-1"
                  onClick={() => setActiveSubMenu("main")}
                >
                  <LuChevronLeft className="w-7 h-7 text-[#eee]" />
                  <span>Playback speed</span>
                </button>
                <div className="max-h-80 overflow-y-auto custom-scrollbar">
                  {PLAYBACK_SPEEDS.map((speed) => (
                    <button
                      key={speed}
                      className="w-full px-4 h-12 flex items-center gap-4 hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[14px] text-[#eee]"
                      onClick={() => {
                        onPlaybackRateChange(speed);
                        setIsOpen(false);
                      }}
                    >
                      {playbackRate === speed ? (
                        <LuCheck className="w-5 h-5 text-[#3ea6ff]" />
                      ) : (
                        <div className="w-5 h-5" />
                      )}
                      <span>{speed === 1 ? "Normal" : speed.toString()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

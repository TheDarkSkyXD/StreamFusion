import React, { useMemo, useRef, useState } from "react";
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

import {
  DEFAULT_CAPTION_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
} from "@shared/auth-types";
import type {
  LocalCaptionModelState,
  LocalCaptionRecognizerPhase,
} from "@shared/local-caption-types";
import { useAuthStore } from "@/store/auth-store";

import { Button } from "../../../../components/ui/button";
import { Switch } from "../../../../components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";

import type { QualityLevel, TimedTextTrack } from "./types";

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
  timedTextTracks?: TimedTextTrack[];
  localTimedTextTrack?: TimedTextTrack;
  currentTimedTextTrackKey?: string | null;
  onTimedTextTrackChange?: (trackKey: string | null) => void;
  localCaptionModel?: LocalCaptionModelState;
  localCaptionPhase?: LocalCaptionRecognizerPhase | "off" | "install-required";
  localCaptionError?: string | null;
  onLocalCaptionModelDownload?: () => void | Promise<unknown>;
  onLocalCaptionModelCancel?: () => void | Promise<unknown>;
  onLocalCaptionModelRemove?: () => void | Promise<unknown>;
  onLocalCaptionRetry?: () => void | Promise<unknown>;
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
  timedTextTracks = [],
  localTimedTextTrack,
  currentTimedTextTrackKey = null,
  onTimedTextTrackChange,
  localCaptionModel,
  localCaptionPhase,
  localCaptionError,
  onLocalCaptionModelDownload,
  onLocalCaptionModelCancel,
  onLocalCaptionModelRemove,
  onLocalCaptionRetry,
}: SettingsMenuProps) {
  const controls =
    useAuthStore((s) => s.preferences?.playerControls) ?? DEFAULT_PLAYER_CONTROLS_PREFERENCES;
  const captionPreferences =
    useAuthStore((s) => s.preferences?.captions) ?? DEFAULT_CAPTION_PREFERENCES;
  const updatePreferences = useAuthStore((s) => s.updatePreferences);

  const [isOpen, setIsOpen] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<"main" | "quality" | "speed" | "captions">(
    "main"
  );
  const captionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
  const captionTracks = useMemo(
    () => (localTimedTextTrack ? [...timedTextTracks, localTimedTextTrack] : timedTextTracks),
    [localTimedTextTrack, timedTextTracks]
  );
  const selectedCaptionTrack = captionTracks.find(
    (track) => track.key === currentTimedTextTrackKey
  );
  const currentCaptionLabel = selectedCaptionTrack
    ? selectedCaptionTrack.label
    : captionPreferences.enabled
      ? "Choose language"
      : "Off";

  const persistCaptionAppearance = (
    updates: Partial<
      Pick<typeof captionPreferences, "textSizePercent" | "backgroundOpacityPercent">
    >
  ) => {
    const current = useAuthStore.getState().preferences?.captions ?? DEFAULT_CAPTION_PREFERENCES;
    void updatePreferences({ captions: { ...current, ...updates } });
  };

  const selectCaptionOption = (track: TimedTextTrack | null) => {
    if (track?.key === localTimedTextTrack?.key && localCaptionModel?.phase !== "ready") return;
    onTimedTextTrackChange?.(track?.key ?? null);
  };

  const moveCaptionFocus = (index: number, direction: 1 | -1) => {
    const optionCount = captionTracks.length + 1;
    const nextIndex = (index + direction + optionCount) % optionCount;
    const track = nextIndex === 0 ? null : captionTracks[nextIndex - 1];
    selectCaptionOption(track);
    captionOptionRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="relative">
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            aria-expanded={isOpen}
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

                {captionTracks.length > 0 && (
                  <button
                    type="button"
                    className="w-full px-4 h-12 flex items-center justify-between hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium"
                    onClick={() => setActiveSubMenu("captions")}
                  >
                    <div className="flex items-center gap-4">
                      <LuFileText className="w-6 h-6" />
                      <span>Subtitles/CC</span>
                    </div>
                    <div className="flex items-center text-[#aaaaaa] gap-1">
                      <span className="text-[13px]">{currentCaptionLabel}</span>
                      <LuChevronRight className="w-5 h-5" />
                    </div>
                  </button>
                )}

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

            {activeSubMenu === "captions" && (
              <div>
                <button
                  type="button"
                  className="w-full px-3 h-12 flex items-center gap-3 hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[15px] text-[#eee] font-medium border-b border-[#ffffff1a] mb-1"
                  onClick={() => setActiveSubMenu("main")}
                >
                  <LuChevronLeft className="w-7 h-7 text-[#eee]" />
                  <span>Subtitles/CC</span>
                </button>

                <div role="radiogroup" aria-label="Subtitles/CC">
                  <button
                    ref={(element) => {
                      captionOptionRefs.current[0] = element;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={currentTimedTextTrackKey === null}
                    tabIndex={currentTimedTextTrackKey === null ? 0 : -1}
                    autoFocus={currentTimedTextTrackKey === null}
                    className="w-full px-4 h-11 flex items-center gap-4 hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[14px] text-[#eee]"
                    onClick={() => selectCaptionOption(null)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                        event.preventDefault();
                        moveCaptionFocus(0, 1);
                      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                        event.preventDefault();
                        moveCaptionFocus(0, -1);
                      }
                    }}
                  >
                    {currentTimedTextTrackKey === null ? (
                      <LuCheck className="w-5 h-5 text-[#3ea6ff]" />
                    ) : (
                      <span className="w-5 h-5" />
                    )}
                    <span>Off</span>
                  </button>

                  {captionTracks.map((track, trackIndex) => {
                    const optionIndex = trackIndex + 1;
                    const checked = currentTimedTextTrackKey === track.key;
                    return (
                      <button
                        key={track.key}
                        ref={(element) => {
                          captionOptionRefs.current[optionIndex] = element;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        tabIndex={checked ? 0 : -1}
                        autoFocus={checked}
                        className="w-full px-4 min-h-11 flex items-center gap-4 hover:bg-[rgba(255,255,255,0.1)] transition-colors text-[14px] text-[#eee]"
                        onClick={() => selectCaptionOption(track)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                            event.preventDefault();
                            moveCaptionFocus(optionIndex, 1);
                          } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                            event.preventDefault();
                            moveCaptionFocus(optionIndex, -1);
                          }
                        }}
                      >
                        {checked ? (
                          <LuCheck className="w-5 h-5 text-[#3ea6ff]" />
                        ) : (
                          <span className="w-5 h-5" />
                        )}
                        <span>{track.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="border-t border-[#ffffff1a] px-4 py-3 text-[#eee]">
                  <label className="mb-3 block text-[13px] font-medium">
                    <span className="mb-1 block">Caption text size</span>
                    <input
                      type="range"
                      aria-label="Caption text size"
                      min={75}
                      max={200}
                      step={25}
                      value={captionPreferences.textSizePercent}
                      onChange={(event) =>
                        persistCaptionAppearance({ textSizePercent: Number(event.target.value) })
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-3 block text-[13px] font-medium">
                    <span className="mb-1 block">Caption background opacity</span>
                    <input
                      type="range"
                      aria-label="Caption background opacity"
                      min={0}
                      max={100}
                      step={10}
                      value={captionPreferences.backgroundOpacityPercent}
                      onChange={(event) =>
                        persistCaptionAppearance({
                          backgroundOpacityPercent: Number(event.target.value),
                        })
                      }
                      className="w-full"
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded-md bg-[#252525] px-3 py-2 text-sm font-semibold text-white hover:bg-[#2d2d2d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    onClick={() =>
                      persistCaptionAppearance({
                        textSizePercent: DEFAULT_CAPTION_PREFERENCES.textSizePercent,
                        backgroundOpacityPercent:
                          DEFAULT_CAPTION_PREFERENCES.backgroundOpacityPercent,
                      })
                    }
                  >
                    Reset caption appearance
                  </button>
                </div>

                {localTimedTextTrack && localCaptionModel && (
                  <div className="border-t border-[#ffffff1a] px-4 py-3 text-[13px] text-[#d4d4d4]">
                    <p>
                      {localCaptionModel.languageLabel} only. Download size:{" "}
                      {localCaptionModel.downloadBytes.toLocaleString("en-US")} bytes (
                      {localCaptionModel.displaySize}).
                    </p>
                    <p>
                      License: {localCaptionModel.license}. Source:{" "}
                      <a
                        className="text-white underline underline-offset-2"
                        href={localCaptionModel.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {localCaptionModel.sourceName}
                      </a>
                    </p>

                    {localCaptionModel.phase === "not-installed" && onLocalCaptionModelDownload && (
                      <button
                        type="button"
                        className="mt-3 rounded-md bg-white px-3 py-2 font-semibold text-[#0f0f0f] hover:bg-white/90"
                        onClick={() => void onLocalCaptionModelDownload()}
                      >
                        Download local caption model
                      </button>
                    )}

                    {localCaptionModel.phase === "downloading" && (
                      <div className="mt-3">
                        {(() => {
                          const progress = Math.min(
                            100,
                            Math.max(
                              0,
                              Math.round(
                                ((localCaptionModel.downloadedBytes ?? 0) /
                                  localCaptionModel.downloadBytes) *
                                  100
                              )
                            )
                          );
                          return (
                            <>
                              <p>
                                Downloading {localCaptionModel.languageLabel} model: {progress}%
                              </p>
                              <progress
                                aria-label="Local caption model download"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={progress}
                                value={progress}
                                max={100}
                                className="mt-2 w-full"
                              />
                            </>
                          );
                        })()}
                        {onLocalCaptionModelCancel && (
                          <button
                            type="button"
                            className="mt-3 rounded-md bg-[#252525] px-3 py-2 font-semibold text-white hover:bg-[#2d2d2d]"
                            onClick={() => void onLocalCaptionModelCancel()}
                          >
                            Cancel download
                          </button>
                        )}
                      </div>
                    )}

                    {localCaptionModel.phase === "integrity-error" && (
                      <div className="mt-3">
                        <p role="alert">{localCaptionModel.error}</p>
                        {onLocalCaptionModelDownload && (
                          <button
                            type="button"
                            className="mt-3 rounded-md bg-white px-3 py-2 font-semibold text-[#0f0f0f] hover:bg-white/90"
                            onClick={() => void onLocalCaptionModelDownload()}
                          >
                            Retry download
                          </button>
                        )}
                      </div>
                    )}

                    {localCaptionModel.phase === "ready" && (
                      <div className="mt-3">
                        <p>Ready offline</p>
                        {localCaptionPhase === "starting" && <p>Starting local recognizer…</p>}
                        {onLocalCaptionModelRemove && (
                          <button
                            type="button"
                            className="mt-3 rounded-md bg-[#252525] px-3 py-2 font-semibold text-white hover:bg-[#2d2d2d]"
                            onClick={() => void onLocalCaptionModelRemove()}
                          >
                            Remove model
                          </button>
                        )}
                      </div>
                    )}

                    {localCaptionError && (
                      <div role="alert" className="mt-3">
                        <p>{localCaptionError}</p>
                        {onLocalCaptionRetry && (
                          <button
                            type="button"
                            className="mt-3 rounded-md bg-white px-3 py-2 font-semibold text-[#0f0f0f] hover:bg-white/90"
                            onClick={() => void onLocalCaptionRetry()}
                          >
                            Retry local captions
                          </button>
                        )}
                      </div>
                    )}
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

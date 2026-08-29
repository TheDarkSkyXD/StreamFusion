import Hls, { type ErrorData, type Events } from "hls.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type CaptionPreferences, DEFAULT_CAPTION_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import type { TimedTextCue, TimedTextError, TimedTextTrack } from "../types";

type HlsSubtitleTrack = Hls["subtitleTracks"][number];

interface NonNativeTrack {
  _id?: string;
  label?: string;
  kind?: string;
  closedCaptions?: HlsSubtitleTrack;
}

const MAX_RETAINED_CUES = 512;

class CueTimeline {
  private cues: TimedTextCue[] = [];

  private key(cue: TimedTextCue): string {
    return [
      cue.startTime,
      cue.endTime,
      cue.text,
      cue.line,
      cue.position,
      cue.size,
      cue.align,
      cue.lineAlign,
      cue.positionAlign,
      cue.snapToLines,
    ].join(":");
  }

  private upperBound(time: number): number {
    let low = 0;
    let high = this.cues.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.cues[middle].startTime <= time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  clear() {
    this.cues = [];
  }

  add(nextCues: TimedTextCue[], playbackTime: number) {
    const cuesByKey = new Map(this.cues.map((cue) => [this.key(cue), cue]));
    for (const cue of nextCues) {
      const normalizedCue = {
        text: cue.text,
        startTime: cue.startTime,
        endTime: cue.endTime,
        align: cue.align,
        line: cue.line,
        lineAlign: cue.lineAlign,
        position: cue.position,
        positionAlign: cue.positionAlign,
        size: cue.size,
        snapToLines: cue.snapToLines,
      };
      cuesByKey.set(this.key(normalizedCue), normalizedCue);
    }
    const sortedCues = [...cuesByKey.values()].sort(
      (a, b) => a.startTime - b.startTime || a.endTime - b.endTime
    );
    if (sortedCues.length <= MAX_RETAINED_CUES) {
      this.cues = sortedCues;
      return;
    }

    this.cues = sortedCues;
    const upperBound = this.upperBound(playbackTime);
    const centeredStart = upperBound - Math.floor(MAX_RETAINED_CUES / 2);
    const latestStart = sortedCues.length - MAX_RETAINED_CUES;
    const windowStart = Math.min(Math.max(centeredStart, 0), latestStart);
    this.cues = sortedCues.slice(windowStart, windowStart + MAX_RETAINED_CUES);
  }

  activeAt(time: number): TimedTextCue[] {
    const upperBound = this.upperBound(time);
    const active: TimedTextCue[] = [];
    for (let index = upperBound - 1; index >= 0; index--) {
      const cue = this.cues[index];
      if (time < cue.endTime) active.push(cue);
    }
    return active.reverse();
  }

  all(): TimedTextCue[] {
    return this.cues;
  }
}

interface NativeTrackState {
  video: HTMLVideoElement;
  track: TextTrack;
}

function createNativeCue(cue: TimedTextCue): TextTrackCue {
  if (typeof VTTCue === "function") {
    return new VTTCue(cue.startTime, cue.endTime, cue.text);
  }
  return cue as unknown as TextTrackCue;
}

function subtitleTrackKey(track: HlsSubtitleTrack): string {
  const stableRenditionId = track.attrs?.["STABLE-RENDITION-ID"]?.trim();
  if (stableRenditionId) return `subtitles:stable:${stableRenditionId}`;

  return `subtitles:${[
    track.groupId,
    track.name,
    track.lang,
    track.url,
    track.instreamId,
    track.type,
  ]
    .filter(Boolean)
    .join("|")}`;
}

function normalizeSubtitleTracks(hls: Hls): TimedTextTrack[] {
  return hls.subtitleTracks.flatMap((track, hlsTrackId) => {
    const language = track.lang?.trim() ?? "";
    const label = track.name?.trim() || language;
    if (!label) return [];
    return [
      {
        key: subtitleTrackKey(track),
        hlsTrackId,
        cueTrack: track.default ? "default" : `subtitles${hlsTrackId}`,
        kind: "subtitles" as const,
        label,
        language,
      },
    ];
  });
}

function getCaptionLanguage(hls: Hls, track: NonNativeTrack, cueTrack: string): string {
  const manifestLanguage = track.closedCaptions?.lang?.trim();
  if (manifestLanguage) return manifestLanguage;

  switch (cueTrack) {
    case "textTrack1":
      return hls.config.captionsTextTrack1LanguageCode.trim();
    case "textTrack2":
      return hls.config.captionsTextTrack2LanguageCode.trim();
    case "textTrack3":
      return hls.config.captionsTextTrack3LanguageCode.trim();
    case "textTrack4":
      return hls.config.captionsTextTrack4LanguageCode.trim();
    default:
      return "";
  }
}

function normalizeCaptionTrack(hls: Hls, track: NonNativeTrack): TimedTextTrack | null {
  const label = track.label?.trim();
  const cueTrack = track._id?.trim();
  if (!label || !cueTrack || track.kind !== "captions") return null;
  return {
    key: `captions:${cueTrack}`,
    hlsTrackId: null,
    cueTrack,
    kind: "captions",
    label,
    language: getCaptionLanguage(hls, track, cueTrack),
  };
}

function findPreferredTrack(
  tracks: TimedTextTrack[],
  preferredLanguage: string | null
): TimedTextTrack | null {
  if (!preferredLanguage) return null;
  const normalizedPreference = preferredLanguage.trim().toLowerCase();
  const exact = tracks.find(
    (track) => track.language.trim().toLowerCase() === normalizedPreference
  );
  if (exact) return exact;

  const preferredBase = normalizedPreference.split("-")[0];
  return (
    tracks.find((track) => track.language.trim().toLowerCase().split("-")[0] === preferredBase) ??
    null
  );
}

interface UseTimedTextOptions {
  usePersistedPreference?: boolean;
}

export function useTimedText(
  hls: Hls | null,
  mediaKey: string,
  video: HTMLVideoElement | null,
  { usePersistedPreference = true }: UseTimedTextOptions = {}
) {
  const captionPreferences =
    useAuthStore((state) => state.preferences?.captions) ?? DEFAULT_CAPTION_PREFERENCES;
  const updatePreferences = useAuthStore((state) => state.updatePreferences);
  const [tracks, setTracks] = useState<TimedTextTrack[]>([]);
  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(null);
  const [activeCues, setActiveCues] = useState<TimedTextCue[]>([]);
  const [error, setError] = useState<TimedTextError | null>(null);
  const tracksRef = useRef<TimedTextTrack[]>([]);
  const captionTracksRef = useRef(new Map<string, TimedTextTrack>());
  const selectedTrackRef = useRef<TimedTextTrack | null>(null);
  const preferenceRef = useRef({
    enabled: captionPreferences.enabled,
    source: captionPreferences.source,
    preferredLanguage: captionPreferences.preferredLanguage,
  });
  useLayoutEffect(() => {
    preferenceRef.current = {
      enabled: captionPreferences.enabled,
      source: captionPreferences.source,
      preferredLanguage: captionPreferences.preferredLanguage,
    };
  }, [
    captionPreferences.enabled,
    captionPreferences.preferredLanguage,
    captionPreferences.source,
  ]);
  const failedTrackKeyRef = useRef<string | null>(null);
  const nativeTrackRef = useRef<NativeTrackState | null>(null);
  const isPipRef = useRef(false);
  const cueStoreRef = useRef<{ mediaKey: string; timeline: CueTimeline }>({
    mediaKey,
    timeline: new CueTimeline(),
  });

  const clearCues = useCallback(() => {
    cueStoreRef.current.timeline.clear();
    setActiveCues([]);
  }, []);

  const clearNativeTrack = useCallback(() => {
    const nativeTrack = nativeTrackRef.current?.track;
    if (!nativeTrack) return;
    for (const cue of Array.from(nativeTrack.cues ?? [])) nativeTrack.removeCue(cue);
    nativeTrack.mode = "disabled";
  }, []);

  useLayoutEffect(() => {
    tracksRef.current = [];
    captionTracksRef.current.clear();
    selectedTrackRef.current = null;
    failedTrackKeyRef.current = null;
    isPipRef.current = false;
    clearNativeTrack();
    setTracks([]);
    setSelectedTrackKey(null);
    setActiveCues([]);
    setError(null);
    cueStoreRef.current = { mediaKey, timeline: new CueTimeline() };
    if (hls) hls.subtitleTrack = -1;
  }, [clearNativeTrack, hls, mediaKey]);

  useEffect(() => {
    if (!hls) return;

    const updateActiveCues = () => {
      if (!video || !selectedTrackRef.current || isPipRef.current) {
        setActiveCues([]);
        return;
      }
      setActiveCues(cueStoreRef.current.timeline.activeAt(video.currentTime));
    };

    const showNativeCues = () => {
      const selected = selectedTrackRef.current;
      if (!video || !selected) return;

      if (nativeTrackRef.current?.video !== video) {
        clearNativeTrack();
        nativeTrackRef.current = {
          video,
          track: video.addTextTrack("captions", "StreamFusion Captions"),
        };
      }

      const nativeTrack = nativeTrackRef.current.track;
      for (const cue of Array.from(nativeTrack.cues ?? [])) nativeTrack.removeCue(cue);
      for (const cue of cueStoreRef.current.timeline.all())
        nativeTrack.addCue(createNativeCue(cue));
      nativeTrack.mode = "showing";
      setActiveCues([]);
    };

    const enterPip = () => {
      isPipRef.current = true;
      showNativeCues();
    };

    const leavePip = () => {
      isPipRef.current = false;
      clearNativeTrack();
      updateActiveCues();
    };

    const applyTracks = (nextTracks: TimedTextTrack[]) => {
      tracksRef.current = nextTracks;
      setTracks(nextTracks);
      const selected = selectedTrackRef.current;
      if (!selected) {
        const failedTrackKey = failedTrackKeyRef.current;
        if (failedTrackKey && !nextTracks.some((track) => track.key === failedTrackKey)) {
          failedTrackKeyRef.current = null;
          setError(null);
        }
        const preferred =
          usePersistedPreference &&
          !failedTrackKeyRef.current &&
          preferenceRef.current.enabled &&
          preferenceRef.current.source === "platform"
            ? findPreferredTrack(nextTracks, preferenceRef.current.preferredLanguage)
            : null;
        hls.subtitleTrack = preferred?.hlsTrackId ?? -1;
        selectedTrackRef.current = preferred;
        setSelectedTrackKey(preferred?.key ?? null);
        return;
      }

      const replacement = nextTracks.find((track) => track.key === selected.key);
      if (!replacement) {
        hls.subtitleTrack = -1;
        selectedTrackRef.current = null;
        setSelectedTrackKey(null);
        clearNativeTrack();
        clearCues();
        return;
      }

      if (replacement.cueTrack !== selected.cueTrack) {
        clearNativeTrack();
        clearCues();
      }
      selectedTrackRef.current = replacement;
      hls.subtitleTrack = replacement.hlsTrackId ?? -1;
    };

    const updateSubtitleTracks = () => {
      applyTracks([...normalizeSubtitleTracks(hls), ...captionTracksRef.current.values()]);
    };

    const clearSubtitleTracks = () => {
      applyTracks([...captionTracksRef.current.values()]);
    };

    const addNonNativeTracks = (_event: string, data: { tracks?: NonNativeTrack[] }) => {
      for (const sourceTrack of data.tracks ?? []) {
        const captionTrack = normalizeCaptionTrack(hls, sourceTrack);
        if (captionTrack) captionTracksRef.current.set(captionTrack.key, captionTrack);
      }
      updateSubtitleTracks();
    };

    const updateCues = (
      _event: string,
      data: {
        cues?: TimedTextCue[];
        type?: "captions" | "subtitles";
        track?: string;
      }
    ) => {
      const selected = selectedTrackRef.current;
      if (!selected || data.type !== selected.kind || data.track !== selected.cueTrack) return;

      cueStoreRef.current.timeline.add(data.cues ?? [], video?.currentTime ?? 0);
      if (isPipRef.current) showNativeCues();
      else updateActiveCues();
    };

    const handleError = (_event: Events.ERROR, data: ErrorData) => {
      if (
        data.details !== Hls.ErrorDetails.SUBTITLE_LOAD_ERROR &&
        data.details !== Hls.ErrorDetails.SUBTITLE_TRACK_LOAD_TIMEOUT
      ) {
        return;
      }

      const selected = selectedTrackRef.current;
      if (!selected || selected.hlsTrackId === null) return;
      if (data.context?.id != null && data.context.id !== selected.hlsTrackId) return;

      failedTrackKeyRef.current = selected.key;
      selectedTrackRef.current = null;
      hls.subtitleTrack = -1;
      setSelectedTrackKey(null);
      setError({
        failedTrackKey: selected.key,
        message: `${selected.label} captions could not be loaded`,
      });
      clearNativeTrack();
      clearCues();
    };

    updateSubtitleTracks();
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, updateSubtitleTracks);
    hls.on(Hls.Events.SUBTITLE_TRACKS_CLEARED, clearSubtitleTracks);
    hls.on(Hls.Events.NON_NATIVE_TEXT_TRACKS_FOUND, addNonNativeTracks);
    hls.on(Hls.Events.CUES_PARSED, updateCues);
    hls.on(Hls.Events.ERROR, handleError);
    video?.addEventListener("timeupdate", updateActiveCues);
    video?.addEventListener("seeked", updateActiveCues);
    video?.addEventListener("enterpictureinpicture", enterPip);
    video?.addEventListener("leavepictureinpicture", leavePip);
    return () => {
      hls.subtitleTrack = -1;
      isPipRef.current = false;
      clearNativeTrack();
      hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, updateSubtitleTracks);
      hls.off(Hls.Events.SUBTITLE_TRACKS_CLEARED, clearSubtitleTracks);
      hls.off(Hls.Events.NON_NATIVE_TEXT_TRACKS_FOUND, addNonNativeTracks);
      hls.off(Hls.Events.CUES_PARSED, updateCues);
      hls.off(Hls.Events.ERROR, handleError);
      video?.removeEventListener("timeupdate", updateActiveCues);
      video?.removeEventListener("seeked", updateActiveCues);
      video?.removeEventListener("enterpictureinpicture", enterPip);
      video?.removeEventListener("leavepictureinpicture", leavePip);
    };
  }, [clearCues, clearNativeTrack, hls, usePersistedPreference, video]);

  useEffect(() => {
    if (!hls) return;
    if (!usePersistedPreference) return;

    if (!captionPreferences.enabled || captionPreferences.source !== "platform") {
      if (!selectedTrackRef.current) return;
      hls.subtitleTrack = -1;
      selectedTrackRef.current = null;
      setSelectedTrackKey(null);
      clearNativeTrack();
      clearCues();
      return;
    }

    if (selectedTrackRef.current) return;
    if (failedTrackKeyRef.current) return;
    const preferred = findPreferredTrack(tracksRef.current, captionPreferences.preferredLanguage);
    if (!preferred) return;
    hls.subtitleTrack = preferred.hlsTrackId ?? -1;
    selectedTrackRef.current = preferred;
    setSelectedTrackKey(preferred.key);
  }, [
    captionPreferences.enabled,
    captionPreferences.preferredLanguage,
    captionPreferences.source,
    clearCues,
    clearNativeTrack,
    hls,
    usePersistedPreference,
  ]);

  const selectTrack = useCallback(
    (trackKey: string | null) => {
      if (!hls) return;
      const selected = trackKey ? tracksRef.current.find((track) => track.key === trackKey) : null;
      if (trackKey && !selected) return;

      hls.subtitleTrack = selected?.hlsTrackId ?? -1;
      selectedTrackRef.current = selected ?? null;
      failedTrackKeyRef.current = null;
      setSelectedTrackKey(selected?.key ?? null);
      setError(null);
      clearNativeTrack();
      clearCues();

      if (!usePersistedPreference) return;

      const currentPreferences =
        useAuthStore.getState().preferences?.captions ?? DEFAULT_CAPTION_PREFERENCES;
      const preferredLanguage =
        selected?.language.trim() || preferenceRef.current.preferredLanguage;
      const nextPreferences: CaptionPreferences = {
        ...currentPreferences,
        enabled: selected !== null,
        source: selected ? "platform" : currentPreferences.source,
        preferredLanguage,
      };
      preferenceRef.current = {
        enabled: nextPreferences.enabled,
        source: nextPreferences.source,
        preferredLanguage: nextPreferences.preferredLanguage,
      };
      void updatePreferences({ captions: nextPreferences });
    },
    [clearCues, clearNativeTrack, hls, updatePreferences, usePersistedPreference]
  );

  const retry = useCallback(() => {
    if (!hls || !failedTrackKeyRef.current) return;
    const selected = tracksRef.current.find((track) => track.key === failedTrackKeyRef.current);
    if (!selected) return;

    hls.subtitleTrack = -1;
    hls.subtitleTrack = selected.hlsTrackId ?? -1;
    selectedTrackRef.current = selected;
    failedTrackKeyRef.current = null;
    setSelectedTrackKey(selected.key);
    setError(null);
    clearCues();
  }, [clearCues, hls]);

  return { tracks, selectedTrackKey, activeCues, error, selectTrack, retry };
}

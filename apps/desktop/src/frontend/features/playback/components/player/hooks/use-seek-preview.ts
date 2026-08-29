import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { logger } from "@/renderer/logging/logger";

type SeekPreviewHlsConfig = Partial<NonNullable<ConstructorParameters<typeof Hls>[0]>>;
const SEEK_PREVIEW_DEBOUNCE_MS = 16;
const MAX_CACHED_PREVIEW_FRAMES = 60;

export interface UseSeekPreviewProps {
  streamUrl: string | null;
  thumbnail?: string;
  hlsConfig?: SeekPreviewHlsConfig;
}

export function useSeekPreview({ streamUrl, thumbnail, hlsConfig }: UseSeekPreviewProps) {
  const [previewImage, setPreviewImage] = useState<string | undefined>(thumbnail);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const isHlsAttachedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const pendingSeekSourceRef = useRef<string | null>(null);
  const previewSourceRef = useRef(streamUrl);
  const frameCacheRef = useRef(new Map<number, string>());

  const releasePreviewDecoder = useCallback(() => {
    const hls = hlsRef.current;
    if (hls) {
      hls.stopLoad();
      if (isHlsAttachedRef.current) {
        hls.detachMedia();
        isHlsAttachedRef.current = false;
      }
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }, []);

  const destroyPreviewPipeline = useCallback(() => {
    releasePreviewDecoder();
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, [releasePreviewDecoder]);

  useEffect(() => {
    previewSourceRef.current = streamUrl;
    pendingSeekSourceRef.current = null;
    frameCacheRef.current.clear();
    setPreviewImage(thumbnail);
  }, [streamUrl, thumbnail]);

  // Initialize hidden elements once
  useEffect(() => {
    if (!videoRef.current) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = "anonymous"; // Important for canvas
      v.preload = "none";
      videoRef.current = v;
    }
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }

    return () => {
      destroyPreviewPipeline();
      videoRef.current = null;
      canvasRef.current = null;
    };
  }, [destroyPreviewPipeline]);

  // Helper to extract frame
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || pendingSeekSourceRef.current !== previewSourceRef.current) return;

    // Set canvas to a reasonable preview size (e.g. 320px width)
    // A smaller size is faster and sufficient for preview
    const width = 320;
    const aspect =
      video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const height = width / aspect;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, width, height);
      try {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.6); // 0.6 quality is enough
        const frameSecond = Math.max(0, Math.round(video.currentTime));
        const cache = frameCacheRef.current;
        cache.delete(frameSecond);
        cache.set(frameSecond, dataUrl);
        while (cache.size > MAX_CACHED_PREVIEW_FRAMES) {
          const oldestSecond = cache.keys().next().value;
          if (oldestSecond === undefined) break;
          cache.delete(oldestSecond);
        }
        if (pendingSeekTimeRef.current === frameSecond) {
          setPreviewImage(dataUrl);
        }
      } catch (e) {
        logger.warn("Player:Hook:SeekPreview", "canvas tainted or error", { error: e });
      }
    }
  }, []);

  const seekPreviewVideo = useCallback(() => {
    const time = pendingSeekTimeRef.current;
    const video = videoRef.current;
    if (!video || time === null || !Number.isFinite(time)) return;
    try {
      video.currentTime = time;
    } catch {
      // A newly attached MediaSource may not be seekable until metadata arrives.
      // loadedmetadata retries this same target without delaying pointer feedback.
    }
  }, []);

  // Listen for both metadata readiness and completed preview seeks.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener("loadedmetadata", seekPreviewVideo);
    video.addEventListener("seeked", captureFrame);
    return () => {
      video.removeEventListener("loadedmetadata", seekPreviewVideo);
      video.removeEventListener("seeked", captureFrame);
    };
  }, [captureFrame, seekPreviewVideo]);

  // Preload only source metadata. HLS fragment loading and decoder attachment
  // remain stopped until hover, so the first real frame is faster without a
  // second video continuously consuming bandwidth, CPU, and memory.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    destroyPreviewPipeline();

    const isHls = streamUrl.includes(".m3u8") || streamUrl.includes("usher.ttvnw.net");

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        autoStartLoad: false,
        enableWorker: true,
        // Optimize for low resource usage
        maxBufferLength: 5, // Keep buffer small
        maxMaxBufferLength: 10,
        maxBufferHole: 0.5,
        ...hlsConfig,
      });

      hls.loadSource(streamUrl);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        // Force lowest quality level for faster seeking and lower bandwidth
        if (data.levels.length > 0) {
          // Find level with ~360p or lowest
          // Just use 0 (usually lowest) or index of lowest bitrate
          // Sorting levels by bitrate/height might be safer, but levels[0] is often lowest in HLS.js sort?
          // Actually HLS.js levels are usually sorted lowest to highest or as in manifest.
          // We'll trust level 0 is efficient enough or iterate to find lowest height.
          let lowestLevel = 0;
          let minHeight = Infinity;

          data.levels.forEach((level, index) => {
            if (level.height && level.height < minHeight) {
              minHeight = level.height;
              lowestLevel = index;
            }
          });

          hls.currentLevel = lowestLevel;
          logger.debug("Player:Hook:SeekPreview", "using quality level", {
            level: lowestLevel,
            height: minHeight,
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          logger.warn("Player:Hook:SeekPreview", "fatal HLS error", {
            type: data.type,
            details: data.details,
          });
          setPreviewImage(undefined);
        }
      });

      hlsRef.current = hls;
    } else {
      // Direct clips can fetch their small metadata header without decoding.
      video.preload = "metadata";
      video.src = streamUrl;
      video.load();
    }

    return destroyPreviewPipeline;
  }, [streamUrl, hlsConfig, destroyPreviewPipeline]);

  const seekTimer = useManagedTimeout(
    useCallback(() => {
      const time = pendingSeekTimeRef.current;
      const video = videoRef.current;
      if (!video || !streamUrl) {
        setPreviewImage(undefined);
        return;
      }
      if (time !== null && Number.isFinite(time)) {
        const hls = hlsRef.current;
        if (hls) hls.startLoad(time);
        seekPreviewVideo();
      }
    }, [streamUrl, seekPreviewVideo])
  );

  const handleSeekHover = useCallback(
    (time: number | null) => {
      if (time === null) {
        pendingSeekTimeRef.current = null;
        pendingSeekSourceRef.current = null;
        seekTimer.clear();
        setPreviewImage(undefined);
        releasePreviewDecoder();
        if (streamUrl && !hlsRef.current) {
          const video = videoRef.current;
          if (video) {
            video.preload = "metadata";
            video.src = streamUrl;
            video.load();
          }
        }
        return;
      }
      const targetSecond = Math.max(0, Math.round(time));
      pendingSeekTimeRef.current = targetSecond;
      pendingSeekSourceRef.current = streamUrl;
      const cachedFrame = frameCacheRef.current.get(targetSecond);
      if (cachedFrame) {
        frameCacheRef.current.delete(targetSecond);
        frameCacheRef.current.set(targetSecond, cachedFrame);
        setPreviewImage(cachedFrame);
        return;
      }
      setPreviewImage(undefined);
      const hls = hlsRef.current;
      const video = videoRef.current;
      if (hls && video && !isHlsAttachedRef.current) {
        hls.attachMedia(video);
        isHlsAttachedRef.current = true;
      }
      seekTimer.start(SEEK_PREVIEW_DEBOUNCE_MS);
    },
    [releasePreviewDecoder, seekTimer, streamUrl]
  );

  return { previewImage, handleSeekHover };
}

import Hls from "hls.js";
import { useEffect, useMemo, useState } from "react";

import { useInterval } from "@/hooks/useInterval";

interface VideoStatsOverlayProps {
  hls?: Hls | null;
  video?: HTMLVideoElement | null;
  onClose?: () => void;
}

interface VideoStats {
  downloadResolution: string;
  renderResolution: string;
  viewportResolution: string;
  downloadBitrate: string;
  bandwidthEstimate: string;
  fps: string;
  skippedFrames: number;
  bufferSize: string;
  latencyToBroadcaster: string;
  playbackRate: string;
  codecs: string;
  protocol: string;
  latencyMode: string;
  renderSurface: string;
  backendVersion: string;
  playSessionId: string;
  servingId: string;
}

export function VideoStatsOverlay({ hls, video, onClose }: VideoStatsOverlayProps) {
  const [stats, setStats] = useState<VideoStats | null>(null);

  // Generate stable IDs for the session
  const sessionIds = useMemo(
    () => ({
      playSessionId: crypto.randomUUID(),
      servingId: crypto.randomUUID(),
    }),
    []
  );

  const updateStats = () => {
    if (!hls || !video) return;

    const level = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const viewportWidth = video.clientWidth;
    const viewportHeight = video.clientHeight;

    // Calculate buffer size in seconds
    let bufferSize = 0;
    if (video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (
          video.buffered.start(i) <= video.currentTime &&
          video.buffered.end(i) >= video.currentTime
        ) {
          bufferSize = video.buffered.end(i) - video.currentTime;
          break;
        }
      }
    }

    // Get dropped frames using standard API
    const playbackQuality = video.getVideoPlaybackQuality?.();
    const droppedFrames = playbackQuality?.droppedVideoFrames ?? 0;

    // Bandwidth estimate
    const bandwidth = hls.bandwidthEstimate ?? 0;

    // Codecs
    const videoCodec = level?.videoCodec;
    const audioCodec = level?.audioCodec;
    const codecs = [videoCodec, audioCodec].filter(Boolean).join(",") || "N/A";

    setStats({
      downloadResolution: level ? `${level.width}x${level.height}` : "N/A",
      renderResolution: `${videoWidth}x${videoHeight}`,
      viewportResolution: `${viewportWidth}x${viewportHeight}`,
      downloadBitrate: level ? `${(level.bitrate / 1000).toFixed(0)} Kbps` : "N/A",
      bandwidthEstimate: `${(bandwidth / 1000).toFixed(0)} Kbps`,
      fps: level?.frameRate ? `${level.frameRate}` : "N/A",
      skippedFrames: droppedFrames,
      bufferSize: `${bufferSize.toFixed(2)} sec.`,
      latencyToBroadcaster: hls.latency != null ? `${hls.latency.toFixed(2)} sec.` : "N/A",
      playbackRate: `${video.playbackRate}`,
      codecs: codecs,
      protocol: "HLS",
      latencyMode: hls.config.lowLatencyMode ? "Low Latency" : "Standard",
      renderSurface: "video",
      backendVersion: Hls.version,
      playSessionId: sessionIds.playSessionId,
      servingId: sessionIds.servingId,
    });
  };

  // Immediate update when hls/video/sessionIds change
  useEffect(() => {
    updateStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hls, video, sessionIds]);

  // 1 Hz stats refresh while hls and video are available
  useInterval(updateStats, hls && video ? 1000 : null);

  if (!stats) return null;

  return (
    <div className="absolute top-4 left-4 z-50 bg-[#0e0e10]/95 text-white p-4 rounded-md font-mono text-xs select-text pointer-events-auto border border-white/10 shadow-xl w-[400px]">
      <div className="absolute top-2 right-2">
        <button
          className="text-white hover:text-gray-300"
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M13.5 0.5L0.5 13.5M0.5 0.5L13.5 13.5"
              stroke="currentColor"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <table className="w-full text-left border-collapse text-white">
        <thead>
          <tr className="border-b border-white/20">
            <th className="py-2 font-bold w-1/2 text-white">Name</th>
            <th className="py-2 font-bold w-1/2 text-white">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-transparent">
          <StatRow label="Download Resolution" value={stats.downloadResolution} />
          <StatRow label="Render Resolution" value={stats.renderResolution} />
          <StatRow label="Viewport Resolution" value={stats.viewportResolution} />
          <StatRow label="Download Bitrate" value={stats.downloadBitrate} />
          <StatRow label="Bandwidth Estimate" value={stats.bandwidthEstimate} />
          <StatRow label="FPS" value={stats.fps} />
          <StatRow label="Skipped Frames" value={stats.skippedFrames.toString()} />
          <StatRow label="Buffer Size" value={stats.bufferSize} />
          <StatRow label="Latency To Broadcaster" value={stats.latencyToBroadcaster} />
          <StatRow label="Playback Rate" value={stats.playbackRate} />
          <StatRow label="Codecs" value={stats.codecs} />
          <StatRow label="Protocol" value={stats.protocol} />
          <StatRow label="Latency Mode" value={stats.latencyMode} />
          <StatRow label="Render Surface" value={stats.renderSurface} />
          <StatRow label="Backend Version" value={stats.backendVersion} />
          <StatRow label="Play Session ID" value={stats.playSessionId} />
          <StatRow label="Serving ID" value={stats.servingId} />
        </tbody>
      </table>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-1 pr-4">{label}</td>
      <td className="py-1">{value}</td>
    </tr>
  );
}

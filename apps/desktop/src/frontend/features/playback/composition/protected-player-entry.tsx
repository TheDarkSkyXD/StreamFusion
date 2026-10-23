import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { LuMaximize2, LuPause, LuPlay, LuVolume2, LuVolumeX, LuX } from "react-icons/lu";

import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { useAdBlockStore } from "@/features/playback/components/state/adblock-store";
import { useVolumeStore } from "@/features/playback/components/state/volume-store";
import { TwitchLivePlayer } from "../components/player/twitch/twitch-live-player";
import { activateDisplayLanguage } from "@/i18n";
import {
  DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
} from "@shared/auth-types";
import { resolveDisplayLanguage } from "@shared/display-language";
import type { ProtectedPlayerBootstrap } from "@shared/protected-playback-types";
import "@/global.css";

interface PlayerWebView {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

function playerWebView(): PlayerWebView {
  const chrome: unknown = Reflect.get(window, "chrome");
  if (!chrome || typeof chrome !== "object" || !("webview" in chrome))
    throw new Error("Player host unavailable");
  const webview: unknown = chrome.webview;
  if (
    !webview ||
    typeof webview !== "object" ||
    !("postMessage" in webview) ||
    !("addEventListener" in webview) ||
    !("removeEventListener" in webview) ||
    typeof webview.postMessage !== "function" ||
    typeof webview.addEventListener !== "function" ||
    typeof webview.removeEventListener !== "function"
  )
    throw new Error("Player host unavailable");
  return webview as PlayerWebView;
}

const captionSchema = z.object({
  enabled: z.boolean(),
  source: z.enum(["platform", "local"]),
  preferredLanguage: z.string().nullable(),
  localModelId: z.string().nullable(),
  textSizePercent: z.number(),
  backgroundOpacityPercent: z.number(),
});
const bootstrapSchema = z.object({
  channelSlug: z.string().regex(/^[A-Za-z0-9_]{1,25}$/),
  masterUrl: z.url().refine((url) => new URL(url).hostname === "usher.ttvnw.net"),
  blockerEnabled: z.boolean(),
  volume: z.number().min(0).max(100),
  muted: z.boolean(),
  preferences: z.object({
    language: z.string(),
    playback: z.object({
      autoPlay: z.boolean(),
      defaultQuality: z.enum([
        "auto",
        "highest",
        "1440p",
        "2k",
        "1080p",
        "720p",
        "480p",
        "360p",
        "160p",
      ]),
      lowLatency: z.boolean(),
      theaterMode: z.boolean(),
      volume: z.number(),
      muted: z.boolean(),
    }),
    playerControls: z.object({
      showQuality: z.boolean(),
      showPlaybackSpeed: z.boolean(),
      showVolume: z.boolean(),
      showFullscreen: z.boolean(),
      showTheater: z.boolean(),
      showPictureInPicture: z.boolean(),
      showVideoStats: z.boolean(),
    }),
    buffer: z.object({
      lowLatencyMode: z.boolean(),
      liveSyncDurationCount: z.number(),
      maxBufferLengthSec: z.number(),
      maxMaxBufferLengthSec: z.number(),
    }),
    playbackAdvanced: z.object({
      playerType: z.enum([
        "default",
        "site",
        "embed",
        "popout",
        "autoplay",
        "picture-by-picture",
        "thunderdome",
      ]),
      allowHevc: z.boolean(),
    }),
    captions: captionSchema,
  }),
});

function configurePlayer(
  bootstrap: ProtectedPlayerBootstrap,
  baseUrl: string,
  webview: PlayerWebView
): void {
  useAuthStore.setState({
    preferences: {
      ...DEFAULT_USER_PREFERENCES,
      ...bootstrap.preferences,
      twitchPlaylistProxy: { ...DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES, enabled: false },
    },
    updatePreferences: async (updates) => {
      if (!updates.captions || Object.keys(updates).length !== 1) return { success: false };
      const captions = captionSchema.safeParse(updates.captions);
      if (!captions.success) return { success: false };
      try {
        const response = await fetch(`${baseUrl}/captions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(captions.data),
        });
        if (!response.ok) return { success: false };
        useAuthStore.setState((state) => ({
          preferences: {
            ...(state.preferences ?? DEFAULT_USER_PREFERENCES),
            captions: captions.data,
          },
        }));
        return { success: true };
      } catch {
        return { success: false };
      }
    },
  });
  useAdBlockStore.setState({ enableAdBlock: bootstrap.blockerEnabled });
  useVolumeStore.setState({ volume: bootstrap.volume, isMuted: bootstrap.muted });
  const unsubscribe = useVolumeStore.subscribe((state, previous) => {
    if (state.volume === previous.volume && state.isMuted === previous.isMuted) return;
    webview.postMessage(
      JSON.stringify({ type: "volume", volume: state.volume, muted: state.isMuted })
    );
  });
  window.addEventListener("beforeunload", unsubscribe, { once: true });
}

function ProtectedPlayer({
  bootstrap,
  baseUrl,
  webview,
  compact,
  isTheater,
  blockerEnabled,
  zoom,
}: {
  bootstrap: ProtectedPlayerBootstrap;
  baseUrl: string;
  webview: PlayerWebView;
  compact: boolean;
  isTheater: boolean;
  blockerEnabled: boolean;
  zoom: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState(bootstrap.masterUrl);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const signalledReady = useRef(false);
  const [playing, setPlaying] = useState(true);
  const muted = useVolumeStore((state) => state.isMuted);
  const lastPointer = useRef<{ screenX: number; screenY: number } | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [revision]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      if (signalledReady.current || video.currentTime <= 0 || video.videoWidth <= 0) return;
      signalledReady.current = true;
      webview.postMessage("playback-ready");
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [revision, webview]);

  const requestLicense = useCallback(
    async (challenge: Uint8Array, signal: AbortSignal) => {
      const response = await fetch(`${baseUrl}/license`, {
        method: "POST",
        body: new Uint8Array(challenge),
        signal,
      });
      if (!response.ok) throw new Error(`License request failed: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    [baseUrl]
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${baseUrl}/refresh`);
      if (!response.ok) throw new Error("Refresh failed");
      const result = z.object({ masterUrl: z.url() }).parse(await response.json());
      signalledReady.current = false;
      setSource(result.masterUrl);
      setRevision((current) => current + 1);
      setError(false);
    } catch {
      setError(true);
    }
  }, [baseUrl]);

  return (
    <TooltipProvider>
      <div className="relative h-screen w-screen bg-black">
        <TwitchLivePlayer
          key={revision}
          ref={videoRef}
          streamUrl={source}
          channelName={bootstrap.channelSlug}
          autoPlay
          muted={false}
          protection={{ kind: "widevine", requestLicense }}
          enableAdBlock={blockerEnabled}
          compact={compact}
          isTheater={isTheater}
          onToggleTheater={() => webview.postMessage("action:theater")}
          onError={() => {
            setError(true);
          }}
          onRefresh={() => {
            void refresh();
          }}
        />
        {compact && (
          <div className="pointer-events-none absolute inset-0 z-40 flex flex-col justify-between bg-gradient-to-t from-black/70 via-transparent to-black/40 text-white opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
            <div
              className="pointer-events-auto flex min-h-10 touch-none items-start justify-end gap-1 p-2"
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest("button")) return;
                lastPointer.current = { screenX: event.screenX, screenY: event.screenY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const last = lastPointer.current;
                if (!last) return;
                const dx = (event.screenX - last.screenX) / zoom;
                const dy = (event.screenY - last.screenY) / zoom;
                lastPointer.current = { screenX: event.screenX, screenY: event.screenY };
                if (dx || dy) webview.postMessage(JSON.stringify({ type: "drag", dx, dy }));
              }}
              onPointerUp={() => {
                lastPointer.current = null;
              }}
              onPointerCancel={() => {
                lastPointer.current = null;
              }}
              onLostPointerCapture={() => {
                lastPointer.current = null;
              }}
            >
              <button
                type="button"
                aria-label="Restore stream"
                onClick={() => webview.postMessage("action:expand")}
                className="rounded-full bg-black/60 p-1.5"
              >
                <LuMaximize2 size={16} />
              </button>
              <button
                type="button"
                aria-label="Close mini player"
                onClick={() => webview.postMessage("action:close")}
                className="rounded-full bg-black/60 p-1.5"
              >
                <LuX size={16} />
              </button>
            </div>
            <div className="pointer-events-auto flex gap-2 p-2">
              <button
                type="button"
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  if (video.paused) void video.play();
                  else video.pause();
                }}
                className="rounded-full bg-black/60 p-1.5"
              >
                {playing ? <LuPause size={16} /> : <LuPlay size={16} />}
              </button>
              <button
                type="button"
                aria-label={muted ? "Unmute" : "Mute"}
                onClick={() => useVolumeStore.getState().setMuted(!muted)}
                className="rounded-full bg-black/60 p-1.5"
              >
                {muted ? <LuVolumeX size={16} /> : <LuVolume2 size={16} />}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 text-white"
          >
            <p>Playback was interrupted.</p>
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              className="rounded bg-white px-4 py-2 text-black"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Protected player root missing");
const webview = playerWebView();
const renderer = createRoot(root);
window.addEventListener(
  "keydown",
  (event) => {
    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      webview.postMessage(event.key === "ArrowLeft" ? "action:back" : "action:forward");
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...document.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((item) => item.getClientRects().length > 0);
    const boundary = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
    if (boundary && document.activeElement !== boundary) return;
    event.preventDefault();
    webview.postMessage(event.shiftKey ? "action:tab-previous" : "action:tab-next");
  },
  true
);
let started = false;
let currentPresentation: "docked" | "theater" | "mini" = "docked";
let currentBlockerEnabled = true;
let currentZoom = 1;
let activeBootstrap: ProtectedPlayerBootstrap | null = null;
let activeBaseUrl = "";
const renderPlayer = () => {
  if (!activeBootstrap) return;
  renderer.render(
    <ProtectedPlayer
      bootstrap={activeBootstrap}
      baseUrl={activeBaseUrl}
      webview={webview}
      compact={currentPresentation === "mini"}
      isTheater={currentPresentation === "theater"}
      blockerEnabled={currentBlockerEnabled}
      zoom={currentZoom}
    />
  );
};
const onMessage = (event: { data: unknown }) => {
  if (
    typeof event.data === "object" &&
    event.data !== null &&
    "type" in event.data &&
    event.data.type === "presentation" &&
    "presentation" in event.data &&
    (event.data.presentation === "docked" ||
      event.data.presentation === "theater" ||
      event.data.presentation === "mini") &&
    "blockerEnabled" in event.data &&
    typeof event.data.blockerEnabled === "boolean"
  ) {
    currentPresentation = event.data.presentation;
    currentBlockerEnabled = event.data.blockerEnabled;
    currentZoom =
      "zoom" in event.data &&
      typeof event.data.zoom === "number" &&
      Number.isFinite(event.data.zoom) &&
      event.data.zoom > 0
        ? event.data.zoom
        : 1;
    useAdBlockStore.setState({ enableAdBlock: currentBlockerEnabled });
    renderPlayer();
    return;
  }
  if (
    started ||
    typeof event.data !== "object" ||
    event.data === null ||
    !("type" in event.data) ||
    event.data.type !== "bootstrap" ||
    !("baseUrl" in event.data) ||
    typeof event.data.baseUrl !== "string" ||
    !/^http:\/\/127\.0\.0\.1:\d+\/s\/[a-f0-9]{64}$/.test(event.data.baseUrl)
  )
    return;
  started = true;
  const baseUrl = event.data.baseUrl;
  void fetch(`${baseUrl}/bootstrap`)
    .then(async (response) => {
      if (!response.ok) throw new Error("Player initialization failed");
      const parsed = bootstrapSchema.parse(await response.json());
      const bootstrap: ProtectedPlayerBootstrap = {
        ...parsed,
        preferences: {
          ...parsed.preferences,
          language: resolveDisplayLanguage(parsed.preferences.language),
        },
      };
      const language = bootstrap.preferences.language;
      await activateDisplayLanguage(language);
      configurePlayer(bootstrap, baseUrl, webview);
      activeBootstrap = bootstrap;
      activeBaseUrl = baseUrl;
      renderPlayer();
      webview.postMessage("bootstrap-ready");
    })
    .catch(() => {
      renderer.render(<p role="alert">The player could not start.</p>);
      webview.postMessage("playback-failed");
    });
};
webview.addEventListener("message", onMessage);
webview.postMessage("page-ready");

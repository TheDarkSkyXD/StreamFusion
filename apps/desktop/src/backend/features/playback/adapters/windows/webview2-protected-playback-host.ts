import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { EventEmitter } from "node:events";
import { join } from "node:path";

import { app, type BrowserWindow } from "electron";

import type {
  ProtectedPlaybackFailure,
  ProtectedPlaybackOpenResult,
  ProtectedPlaybackPresentRequest,
  ProtectedPlaybackState,
} from "@shared/protected-playback-types";
import type { ProtectedPlayerPreferences } from "@shared/protected-playback-types";
import type { ProtectedTwitchGateway } from "../twitch/protected-twitch-gateway";
import { createProtectedTwitchSession } from "../twitch/protected-twitch-session";
import { preferencesRepository } from "@backend/features/settings/data/preferences-repository";
import { createCancellableSleep, type CancellableSleep } from "@shared/utils/sleep";

const START_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 1_500;
const MAX_LINE_BYTES = 4_096;

interface OpenInput {
  ownerKey: string;
  ownerId: string;
  channelSlug: string;
  muted: boolean;
  forcedMuted?: boolean;
  volume?: number;
  blockerEnabled?: boolean;
  preferences?: Partial<ProtectedPlayerPreferences>;
  window: BrowserWindow;
  onState: (state: ProtectedPlaybackState) => void;
}

interface HostedPlayer {
  child: ChildProcessWithoutNullStreams;
  input: OpenInput;
  ready: Promise<ProtectedPlaybackOpenResult>;
  resolveReady: (result: ProtectedPlaybackOpenResult) => void;
  started: boolean;
  pageReady: boolean;
  finished: boolean;
  pendingLine: string;
  startTimeout: CancellableSleep;
  closeTimeout: CancellableSleep | null;
  gateway: ProtectedTwitchGateway;
  inFlightRevision: number | null;
  appliedRevision: number;
  unbindWindow: () => void;
  originalFullscreen: boolean | null;
}

type Presentation = Omit<ProtectedPlaybackPresentRequest, "ownerId">;

function helperPath(): string {
  const base = app.isPackaged ? process.resourcesPath : process.cwd();
  return app.isPackaged
    ? join(base, "protected-player", "StreamFusion.ProtectedPlayer.exe")
    : join(base, ".cache", "native", "protected-player", "StreamFusion.ProtectedPlayer.exe");
}

function sendCommand(player: HostedPlayer, command: object): void {
  if (player.child.stdin.destroyed) return;
  player.child.stdin.write(`${JSON.stringify(command)}\n`);
}

export class WebView2ProtectedPlaybackHost {
  readonly #players = new Map<string, HostedPlayer>();
  readonly #closing = new Map<string, Promise<void>>();
  readonly #pendingOpens = new Map<string, Set<{ cancelled: boolean }>>();
  readonly #preparing = new Map<string, { cancelled: boolean }>();
  readonly #opening = new Map<string, Promise<ProtectedPlaybackOpenResult>>();
  readonly #presentations = new Map<string, Presentation>();
  readonly #presentWaiters = new Map<string, Set<() => void>>();

  constructor(
    private readonly createSession: typeof createProtectedTwitchSession = createProtectedTwitchSession
  ) {}

  async open(input: OpenInput): Promise<ProtectedPlaybackOpenResult> {
    const opening = this.#opening.get(input.ownerKey);
    if (opening) return opening;
    const attempt = this.#open(input);
    this.#opening.set(input.ownerKey, attempt);
    void attempt.finally(() => {
      if (this.#opening.get(input.ownerKey) === attempt) this.#opening.delete(input.ownerKey);
    });
    return attempt;
  }

  async #open(input: OpenInput): Promise<ProtectedPlaybackOpenResult> {
    if (process.platform !== "win32") {
      this.close(input.ownerKey);
      return { kind: "unavailable", reason: "unsupported-platform" };
    }
    const closing = this.#closing.get(input.ownerKey);
    if (closing) {
      const pending = { cancelled: false };
      const waiters = this.#pendingOpens.get(input.ownerKey) ?? new Set();
      waiters.add(pending);
      this.#pendingOpens.set(input.ownerKey, waiters);
      await closing;
      waiters.delete(pending);
      if (waiters.size === 0) this.#pendingOpens.delete(input.ownerKey);
      if (pending.cancelled) {
        return { kind: "unavailable", reason: "host-start-failed" };
      }
    }
    const existing = this.#players.get(input.ownerKey);
    if (existing) {
      if (existing.started) sendCommand(existing, { type: "focus" });
      return existing.ready;
    }

    const preparation = { cancelled: false };
    this.#preparing.set(input.ownerKey, preparation);
    let gateway: ProtectedTwitchGateway;
    try {
      gateway = await this.createSession({
        channelSlug: input.channelSlug,
        muted: input.muted,
        volume: input.volume ?? 100,
        blockerEnabled: input.blockerEnabled ?? true,
        preferences:
          input.preferences ??
          (() => {
            const settings = preferencesRepository.getPreferences();
            return {
              language: settings.language,
              playback: settings.playback,
              playerControls: settings.playerControls,
              buffer: settings.buffer,
              playbackAdvanced: settings.playbackAdvanced,
              captions: settings.captions,
            };
          })(),
      });
    } catch {
      this.#preparing.delete(input.ownerKey);
      this.close(input.ownerKey);
      return { kind: "unavailable", reason: "host-start-failed" };
    }
    this.#preparing.delete(input.ownerKey);
    if (preparation.cancelled) {
      await gateway.close();
      return { kind: "unavailable", reason: "host-start-failed" };
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        helperPath(),
        [
          "--channel",
          input.channelSlug,
          "--owner",
          input.window.getNativeWindowHandle().readBigUInt64LE().toString(),
          "--parent-pid",
          String(process.pid),
          "--user-data-dir",
          join(app.getPath("userData"), "protected-player"),
          "--muted",
          String(input.forcedMuted ?? false),
        ],
        { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] }
      );
    } catch {
      await gateway.close();
      this.close(input.ownerKey);
      return { kind: "unavailable", reason: "host-start-failed" };
    }

    let resolveReady!: HostedPlayer["resolveReady"];
    const ready = new Promise<ProtectedPlaybackOpenResult>((resolve) => {
      resolveReady = resolve;
    });
    const player: HostedPlayer = {
      child,
      input,
      ready,
      resolveReady,
      started: false,
      pageReady: false,
      finished: false,
      pendingLine: "",
      startTimeout: createCancellableSleep(START_TIMEOUT_MS, { unref: true }),
      closeTimeout: null,
      gateway,
      inFlightRevision: null,
      appliedRevision: -1,
      unbindWindow: () => {},
      originalFullscreen: null,
    };
    this.#players.set(input.ownerKey, player);
    const raise = () => {
      if (input.window.isVisible() && !input.window.isMinimized())
        sendCommand(player, { type: "raise" });
    };
    const suspend = () => sendCommand(player, { type: "suspend" });
    const events = [
      "show",
      "restore",
      "focus",
      "move",
      "resize",
      "enter-full-screen",
      "leave-full-screen",
    ] as const;
    const lifecycle: EventEmitter = input.window;
    for (const event of events) lifecycle.on(event, raise);
    lifecycle.on("hide", suspend);
    lifecycle.on("minimize", suspend);
    player.unbindWindow = () => {
      for (const event of events) lifecycle.removeListener(event, raise);
      lifecycle.removeListener("hide", suspend);
      lifecycle.removeListener("minimize", suspend);
    };
    void player.startTimeout.result.then((result) => {
      if (result.ok) this.#finish(player, "host-start-failed");
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#readLines(player, chunk));
    child.stderr.resume();
    child.stdin.on("error", () => this.#finish(player, "host-start-failed"));
    child.on("error", () => this.#finish(player, "host-start-failed"));
    child.on("exit", () => this.#finish(player));
    sendCommand(player, { type: "session", baseUrl: gateway.baseUrl });
    if (!input.window.isVisible() || input.window.isMinimized()) suspend();
    this.#sendPresentation(player);
    return ready;
  }

  present(ownerKey: string, presentation: Presentation): Promise<void> {
    const previous = this.#presentations.get(ownerKey);
    if (previous && presentation.revision <= previous.revision) return Promise.resolve();
    this.#presentations.set(ownerKey, presentation);
    const acknowledgement = new Promise<void>((resolve) => {
      const waiters = this.#presentWaiters.get(ownerKey) ?? new Set();
      waiters.add(resolve);
      this.#presentWaiters.set(ownerKey, waiters);
    });
    const player = this.#players.get(ownerKey);
    if (player) this.#sendPresentation(player);
    return acknowledgement;
  }

  #sendPresentation(player: HostedPlayer): void {
    if (player.finished || player.inFlightRevision !== null) return;
    const presentation = this.#presentations.get(player.input.ownerKey);
    if (!presentation || presentation.revision <= player.appliedRevision) return;
    const { revision, layout, presentation: mode, blockerEnabled } = presentation;
    player.inFlightRevision = revision;
    if (layout.kind === "hidden") {
      sendCommand(player, { type: "present", revision, visible: false });
      return;
    }
    const { boundsCss, clipCss, radiusCss } = layout;
    sendCommand(player, {
      type: "present",
      revision,
      visible: true,
      x: boundsCss.x,
      y: boundsCss.y,
      width: boundsCss.width,
      height: boundsCss.height,
      clipX: clipCss.x - boundsCss.x,
      clipY: clipCss.y - boundsCss.y,
      clipWidth: clipCss.width,
      clipHeight: clipCss.height,
      radius: radiusCss,
      zoom: player.input.window.webContents.getZoomFactor(),
      presentation: mode,
      blockerEnabled,
    });
  }

  #resolvePresentation(ownerKey: string): void {
    const waiters = this.#presentWaiters.get(ownerKey);
    this.#presentWaiters.delete(ownerKey);
    for (const resolve of waiters ?? []) resolve();
  }

  focus(ownerKey: string): void {
    const player = this.#players.get(ownerKey);
    if (player?.started) sendCommand(player, { type: "focus" });
  }

  mute(ownerKey: string, muted: boolean): void {
    const player = this.#players.get(ownerKey);
    if (player) sendCommand(player, { type: "mute", muted });
  }

  close(ownerKey: string): void {
    this.#presentations.delete(ownerKey);
    this.#resolvePresentation(ownerKey);
    const preparation = this.#preparing.get(ownerKey);
    if (preparation) preparation.cancelled = true;
    for (const pending of this.#pendingOpens.get(ownerKey) ?? []) pending.cancelled = true;
    const player = this.#players.get(ownerKey);
    if (player) this.#finish(player);
  }

  closeOwner(senderId: number): void {
    for (const key of new Set([
      ...this.#players.keys(),
      ...this.#pendingOpens.keys(),
      ...this.#preparing.keys(),
      ...this.#presentations.keys(),
    ])) {
      if (key.startsWith(`${senderId}:`)) this.close(key);
    }
  }

  closeAll(): void {
    for (const key of new Set([
      ...this.#players.keys(),
      ...this.#pendingOpens.keys(),
      ...this.#preparing.keys(),
      ...this.#presentations.keys(),
    ])) {
      this.close(key);
    }
  }

  #readLines(player: HostedPlayer, chunk: string): void {
    player.pendingLine += chunk;
    let newline = player.pendingLine.indexOf("\n");
    while (newline >= 0) {
      const line = player.pendingLine.slice(0, newline);
      player.pendingLine = player.pendingLine.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        this.#finish(player, "host-start-failed");
        return;
      }
      try {
        const message: unknown = JSON.parse(line);
        if (typeof message === "object" && message !== null && "type" in message) {
          if (message.type === "ready") {
            player.pageReady = true;
            this.#markStarted(player);
          } else if (
            message.type === "presented" &&
            player.inFlightRevision !== null &&
            "message" in message &&
            message.message === String(player.inFlightRevision)
          ) {
            player.appliedRevision = player.inFlightRevision;
            player.inFlightRevision = null;
            if (
              this.#presentations.get(player.input.ownerKey)?.revision === Number(message.message)
            ) {
              this.#resolvePresentation(player.input.ownerKey);
            }
            this.#sendPresentation(player);
            this.#markStarted(player);
          } else if (
            message.type === "fullscreen" &&
            "message" in message &&
            (message.message === "true" || message.message === "false")
          ) {
            const active = message.message === "true";
            if (active) {
              if (player.originalFullscreen === null)
                player.originalFullscreen = player.input.window.isFullScreen();
              player.input.window.setFullScreen(true);
            } else if (player.originalFullscreen !== null) {
              player.input.window.setFullScreen(player.originalFullscreen);
              player.originalFullscreen = null;
            }
            player.input.onState({ kind: "fullscreen", ownerId: player.input.ownerId, active });
          } else if (
            message.type === "action" &&
            "message" in message &&
            (message.message === "expand" ||
              message.message === "close" ||
              message.message === "theater" ||
              message.message === "back" ||
              message.message === "forward" ||
              message.message === "tab-next" ||
              message.message === "tab-previous")
          ) {
            player.input.onState({
              kind: "action",
              ownerId: player.input.ownerId,
              action: message.message,
            });
          } else if (
            message.type === "drag" &&
            "message" in message &&
            typeof message.message === "string"
          ) {
            const delta: unknown = JSON.parse(message.message);
            if (
              typeof delta === "object" &&
              delta !== null &&
              "dx" in delta &&
              "dy" in delta &&
              typeof delta.dx === "number" &&
              typeof delta.dy === "number" &&
              Number.isFinite(delta.dx) &&
              Number.isFinite(delta.dy) &&
              Math.abs(delta.dx) <= 2000 &&
              Math.abs(delta.dy) <= 2000
            ) {
              player.input.onState({
                kind: "drag",
                ownerId: player.input.ownerId,
                dx: delta.dx,
                dy: delta.dy,
              });
            }
          } else if (message.type === "closed") {
            this.#finish(player);
          } else if (message.type === "failed") {
            this.#finish(
              player,
              "message" in message && message.message === "runtime-missing"
                ? "runtime-missing"
                : "host-start-failed"
            );
          } else if (
            message.type === "volume" &&
            "message" in message &&
            typeof message.message === "string"
          ) {
            const value: unknown = JSON.parse(message.message);
            if (
              typeof value === "object" &&
              value !== null &&
              "type" in value &&
              value.type === "volume" &&
              "volume" in value &&
              typeof value.volume === "number" &&
              value.volume >= 0 &&
              value.volume <= 100 &&
              "muted" in value &&
              typeof value.muted === "boolean"
            ) {
              player.input.onState({
                kind: "volume",
                ownerId: player.input.ownerId,
                volume: value.volume,
                muted: value.muted,
              });
            }
          }
        }
      } catch {
        this.#finish(player, "host-start-failed");
      }
      if (player.finished) return;
      newline = player.pendingLine.indexOf("\n");
    }
    if (Buffer.byteLength(player.pendingLine, "utf8") > MAX_LINE_BYTES) {
      this.#finish(player, "host-start-failed");
    }
  }

  #markStarted(player: HostedPlayer): void {
    if (player.started || !player.pageReady || player.inFlightRevision !== null || player.finished)
      return;
    player.started = true;
    player.startTimeout.cancel();
    player.resolveReady({ kind: "opened" });
  }

  #finish(player: HostedPlayer, reason?: ProtectedPlaybackFailure): void {
    if (player.finished) return;
    player.finished = true;
    player.unbindWindow();
    if (player.originalFullscreen !== null && !player.input.window.isDestroyed()) {
      player.input.window.setFullScreen(player.originalFullscreen);
    }
    this.#presentations.delete(player.input.ownerKey);
    this.#resolvePresentation(player.input.ownerKey);
    void player.gateway.close();
    this.#players.delete(player.input.ownerKey);
    player.startTimeout.cancel();
    player.closeTimeout?.cancel();
    player.resolveReady(
      reason
        ? { kind: "unavailable", reason }
        : { kind: "unavailable", reason: "host-start-failed" }
    );
    player.input.onState(
      reason
        ? { kind: "failed", ownerId: player.input.ownerId, reason }
        : { kind: "closed", ownerId: player.input.ownerId }
    );
    if (player.child.exitCode === null && !player.child.killed) {
      const closing = new Promise<void>((resolve) => player.child.once("close", () => resolve()));
      this.#closing.set(player.input.ownerKey, closing);
      void closing.then(() => {
        if (this.#closing.get(player.input.ownerKey) === closing) {
          this.#closing.delete(player.input.ownerKey);
        }
        player.closeTimeout?.cancel();
      });
      sendCommand(player, { type: "close" });
      player.child.stdin.end();
      player.closeTimeout = createCancellableSleep(CLOSE_TIMEOUT_MS, { unref: true });
      void player.closeTimeout.result.then((result) => {
        if (result.ok && player.child.exitCode === null) player.child.kill();
      });
    }
  }
}

export const protectedPlaybackHost = new WebView2ProtectedPlaybackHost();

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

import { app, type BrowserWindow } from "electron";

import type {
  ProtectedPlaybackFailure,
  ProtectedPlaybackOpenResult,
  ProtectedPlaybackState,
} from "@shared/protected-playback-types";
import { createCancellableSleep, type CancellableSleep } from "@shared/utils/sleep";

const START_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 1_500;
const MAX_LINE_BYTES = 4_096;

interface OpenInput {
  ownerKey: string;
  ownerId: string;
  channelSlug: string;
  muted: boolean;
  window: BrowserWindow;
  onState: (state: ProtectedPlaybackState) => void;
}

interface HostedPlayer {
  child: ChildProcessWithoutNullStreams;
  input: OpenInput;
  ready: Promise<ProtectedPlaybackOpenResult>;
  resolveReady: (result: ProtectedPlaybackOpenResult) => void;
  started: boolean;
  finished: boolean;
  pendingLine: string;
  startTimeout: CancellableSleep;
  closeTimeout: CancellableSleep | null;
}

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

  async open(input: OpenInput): Promise<ProtectedPlaybackOpenResult> {
    if (process.platform !== "win32") {
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
          String(input.muted),
        ],
        { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] }
      );
    } catch {
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
      finished: false,
      pendingLine: "",
      startTimeout: createCancellableSleep(START_TIMEOUT_MS, { unref: true }),
      closeTimeout: null,
    };
    this.#players.set(input.ownerKey, player);
    void player.startTimeout.result.then((result) => {
      if (result.ok) this.#finish(player, "host-start-failed");
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#readLines(player, chunk));
    child.stderr.resume();
    child.stdin.on("error", () => this.#finish(player, "host-start-failed"));
    child.on("error", () => this.#finish(player, "host-start-failed"));
    child.on("exit", () => this.#finish(player));
    return ready;
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
    for (const pending of this.#pendingOpens.get(ownerKey) ?? []) pending.cancelled = true;
    const player = this.#players.get(ownerKey);
    if (player) this.#finish(player);
  }

  closeOwner(senderId: number): void {
    for (const key of new Set([...this.#players.keys(), ...this.#pendingOpens.keys()])) {
      if (key.startsWith(`${senderId}:`)) this.close(key);
    }
  }

  closeAll(): void {
    for (const key of new Set([...this.#players.keys(), ...this.#pendingOpens.keys()])) {
      this.close(key);
    }
  }

  #readLines(player: HostedPlayer, chunk: string): void {
    player.pendingLine += chunk;
    if (Buffer.byteLength(player.pendingLine, "utf8") > MAX_LINE_BYTES) {
      this.#finish(player, "host-start-failed");
      return;
    }
    let newline = player.pendingLine.indexOf("\n");
    while (newline >= 0) {
      const line = player.pendingLine.slice(0, newline);
      player.pendingLine = player.pendingLine.slice(newline + 1);
      try {
        const message: unknown = JSON.parse(line);
        if (typeof message === "object" && message !== null && "type" in message) {
          if (message.type === "ready") {
            player.started = true;
            player.startTimeout.cancel();
            player.resolveReady({ kind: "opened" });
          } else if (message.type === "closed") {
            this.#finish(player);
          } else if (message.type === "failed") {
            this.#finish(
              player,
              "message" in message && message.message === "runtime-missing"
                ? "runtime-missing"
                : "host-start-failed"
            );
          }
        }
      } catch {
        this.#finish(player, "host-start-failed");
      }
      if (player.finished) return;
      newline = player.pendingLine.indexOf("\n");
    }
  }

  #finish(player: HostedPlayer, reason?: ProtectedPlaybackFailure): void {
    if (player.finished) return;
    player.finished = true;
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

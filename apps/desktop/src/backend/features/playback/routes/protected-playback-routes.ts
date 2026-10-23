import { z } from "zod";

import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { ProtectedPlaybackOpenResult } from "@shared/protected-playback-types";
import { trustedIpcMain as ipcMain } from "@backend/ipc/trusted-ipc-main";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";
import type { WebView2ProtectedPlaybackHost } from "../adapters/windows/webview2-protected-playback-host";
import { isTwitchStreamEncrypted } from "../adapters/twitch/twitch-protected-stream-metadata";

const ownerId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const channelSlug = z.string().regex(/^[a-zA-Z0-9_]{1,25}$/);
const openRequest = z
  .object({
    ownerId,
    channelSlug,
    muted: z.boolean(),
    volume: z.number().min(0).max(100).optional(),
    blockerEnabled: z.boolean().optional(),
    forcedMuted: z.boolean().optional(),
  })
  .strict();
const ownerRequest = z.object({ ownerId }).strict();
const muteRequest = z.object({ ownerId, muted: z.boolean() }).strict();
const coordinate = z.number().finite().min(-16384).max(16384);
const size = z.number().finite().positive().max(16384);
const rect = z.strictObject({ x: coordinate, y: coordinate, width: size, height: size });
const presentRequest = z
  .strictObject({
    ownerId,
    revision: z.number().int().nonnegative().max(2147483647),
    layout: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("hidden") }),
      z.strictObject({
        kind: z.literal("visible"),
        boundsCss: rect,
        clipCss: rect,
        radiusCss: z.number().finite().min(0).max(256),
      }),
    ]),
    presentation: z.enum(["docked", "theater", "mini"]),
    blockerEnabled: z.boolean(),
  })
  .refine((value) => {
    if (value.layout.kind === "hidden") return true;
    const { boundsCss: bounds, clipCss: clip } = value.layout;
    return (
      clip.x >= bounds.x &&
      clip.y >= bounds.y &&
      clip.x + clip.width <= bounds.x + bounds.width &&
      clip.y + clip.height <= bounds.y + bounds.height
    );
  });
const checkRequest = z.object({ channelSlug }).strict();
const invalidOpen: ProtectedPlaybackOpenResult = {
  kind: "unavailable",
  reason: "host-start-failed",
};

type Renderer = Pick<MainRendererPort, "current" | "sendToOwner" | "useWindow">;
type Host = Pick<
  WebView2ProtectedPlaybackHost,
  "open" | "focus" | "close" | "mute" | "present" | "closeOwner"
>;

export function registerProtectedPlaybackRoutes(
  renderer: Renderer,
  host: Host,
  detect: (slug: string) => Promise<boolean> = isTwitchStreamEncrypted
): void {
  renderer.useWindow("protected-playback", (window) => {
    const senderId = window.webContents.id;
    const close = () => host.closeOwner(senderId);
    const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) close();
    };
    window.webContents.on("did-start-navigation", onNavigation);
    window.webContents.on("render-process-gone", close);
    return () => {
      window.webContents.removeListener("did-start-navigation", onNavigation);
      window.webContents.removeListener("render-process-gone", close);
      close();
    };
  });

  ipcMain.handle(IPC_CHANNELS.PROTECTED_PLAYBACK_CHECK, async (_event, value: unknown) => {
    const parsed = checkRequest.safeParse(value);
    if (!parsed.success) return false;
    return detect(parsed.data.channelSlug);
  });

  ipcMain.handle(IPC_CHANNELS.PROTECTED_PLAYBACK_OPEN, async (event, value: unknown) => {
    const parsed = openRequest.safeParse(value);
    if (!parsed.success) return invalidOpen;
    const window = renderer.current();
    if (!window || window.webContents.id !== event.sender.id) return invalidOpen;
    const {
      ownerId: id,
      channelSlug: slug,
      muted,
      volume,
      blockerEnabled,
      forcedMuted,
    } = parsed.data;
    return host.open({
      ownerKey: `${event.sender.id}:${id}`,
      ownerId: id,
      channelSlug: slug,
      muted,
      volume,
      blockerEnabled,
      forcedMuted,
      window,
      onState: (state) => {
        renderer.sendToOwner(event.sender.id, IPC_CHANNELS.PROTECTED_PLAYBACK_STATE, state);
      },
    });
  });

  ipcMain.handle(IPC_CHANNELS.PROTECTED_PLAYBACK_FOCUS, (event, value: unknown) => {
    const parsed = ownerRequest.safeParse(value);
    if (parsed.success) host.focus(`${event.sender.id}:${parsed.data.ownerId}`);
  });

  ipcMain.handle(IPC_CHANNELS.PROTECTED_PLAYBACK_CLOSE, (event, value: unknown) => {
    const parsed = ownerRequest.safeParse(value);
    if (parsed.success) host.close(`${event.sender.id}:${parsed.data.ownerId}`);
  });

  ipcMain.handle(IPC_CHANNELS.PROTECTED_PLAYBACK_MUTE, (event, value: unknown) => {
    const parsed = muteRequest.safeParse(value);
    if (parsed.success) host.mute(`${event.sender.id}:${parsed.data.ownerId}`, parsed.data.muted);
  });

  ipcMain.handle(IPC_CHANNELS.PROTECTED_PLAYBACK_PRESENT, async (event, value: unknown) => {
    const parsed = presentRequest.safeParse(value);
    const window = renderer.current();
    if (!parsed.success || !window || window.webContents.id !== event.sender.id) return;
    const { ownerId: id, ...presentation } = parsed.data;
    await host.present(`${event.sender.id}:${id}`, presentation);
  });
}

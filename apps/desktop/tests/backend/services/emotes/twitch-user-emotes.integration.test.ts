import { afterEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: { handle: electronMocks.handle },
}));

import { registerTwitchApiHandlers } from "@backend/ipc/handlers/twitch-api-handlers";
import { EmoteManager } from "@backend/services/emotes/emote-manager";
import { twitchEmoteProvider } from "@backend/services/emotes/twitch-emotes";
import type { Emote, EmoteProviderService } from "@backend/services/emotes/emote-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";

type Handler = (
  event: { senderFrame?: { url?: string } },
  payload: unknown
) => Promise<TwitchApiResult>;

function handlerFor(channel: string): Handler {
  const calls = electronMocks.handle.mock.calls as Array<[string, Handler]>;
  const match = calls.find(([registered]) => registered === channel);
  if (!match) throw new Error(`Missing handler for ${channel}`);
  return match[1];
}

function makeFreshTwitchProvider(): EmoteProviderService {
  const provider = Object.create(
    Object.getPrototypeOf(twitchEmoteProvider),
    Object.getOwnPropertyDescriptors(twitchEmoteProvider)
  ) as typeof twitchEmoteProvider;
  provider.configure();
  return provider;
}

function emote(id: string, name: string, provider: Emote["provider"]): Emote {
  return {
    id,
    name,
    provider,
    isGlobal: true,
    isAnimated: false,
    isZeroWidth: false,
    urls: {
      url1x: `https://example.test/${id}/1x`,
      url2x: `https://example.test/${id}/2x`,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Guards: restored Twitch auth uses the validated token subject for user emotes, even when the separately persisted profile identity is stale or legacy-shaped.
// Guards: a rejected Twitch user-emote capability never discards global/third-party emotes or rejects the global load that chat awaits.
describe("Twitch user-emote capability through the global loader", () => {
  it("loads restored-session user emotes across an opaque long pagination cursor", async () => {
    const longCursor = "opaque".repeat(683);
    const service = {
      execute: vi.fn(async (command: TwitchApiCommand): Promise<TwitchApiResult> => {
        if (command.operation === "get-global-emotes") {
          return {
            ok: true,
            data: {
              data: [
                {
                  id: "global-1",
                  name: "Kappa",
                  format: ["static"],
                  scale: ["1.0", "2.0", "3.0"],
                  theme_mode: ["dark"],
                  images: { url_1x: "", url_2x: "", url_4x: "" },
                },
              ],
            },
          };
        }
        if (command.operation === "get-user-emotes") {
          if (command.after === longCursor) {
            return {
              ok: true,
              data: {
                data: [
                  {
                    id: "limited-1",
                    name: "LimitedWave",
                    emote_type: "limitedtime",
                    owner_id: "owner-1",
                    format: ["static"],
                    scale: ["1.0", "2.0", "3.0"],
                    theme_mode: ["dark"],
                    images: { url_1x: "", url_2x: "", url_4x: "" },
                  },
                ],
                pagination: {},
              },
            };
          }
          return {
            ok: true,
            data: {
              data: [
                {
                  id: "subscriber-1",
                  name: "SubWave",
                  emote_type: "subscriptions",
                  owner_id: "owner-1",
                  format: ["static"],
                  scale: ["1.0", "2.0", "3.0"],
                  theme_mode: ["dark"],
                  images: { url_1x: "", url_2x: "", url_4x: "" },
                },
              ],
              pagination: { cursor: longCursor },
            },
          };
        }
        if (command.operation === "get-users") {
          return {
            ok: true,
            data: {
              data: [
                {
                  id: "owner-1",
                  login: "owner",
                  display_name: "Owner",
                  profile_image_url: "https://example.test/owner.webp",
                },
              ],
            },
          };
        }
        return { ok: false, error: { code: "invalid-input", message: "Unexpected command." } };
      }),
    };
    registerTwitchApiHandlers({ service });
    const invoke = handlerFor(IPC_CHANNELS.TWITCH_API_EXECUTE);
    const invalidResults: TwitchApiResult[] = [];

    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      electronAPI: {
        auth: {
          tokenStatus: vi.fn(async () => ({
            platform: "twitch" as const,
            connected: true,
            valid: true,
            userId: "validated-user",
            scopes: ["user:read:emotes"],
          })),
          // Models a restored legacy profile whose runtime shape predates the
          // current string-ID contract. The validated token subject is authoritative.
          getTwitchUser: vi.fn(async () => ({ id: 123 })),
        },
        twitch: {
          execute: vi.fn(async (command: TwitchApiCommand) => {
            const result = await invoke(
              { senderFrame: { url: "http://localhost:5173/" } },
              command
            );
            if (!result.ok) invalidResults.push(result);
            return result;
          }),
        },
      },
    });

    const manager = new EmoteManager();
    manager.registerProvider(makeFreshTwitchProvider());
    manager.registerProvider({
      name: "bttv",
      fetchGlobalEmotes: vi.fn(async () => [emote("bttv-1", "OMEGALUL", "bttv")]),
      fetchChannelEmotes: vi.fn(async () => []),
      getEmoteUrl: (item) => item.urls.url2x,
    });

    try {
      await expect(manager.loadGlobalEmotes("twitch")).resolves.toBeUndefined();

      expect(invalidResults).toEqual([]);
      expect(service.execute).toHaveBeenCalledWith({
        operation: "get-user-emotes",
        userId: "validated-user",
        after: undefined,
      });
      expect(service.execute).toHaveBeenCalledWith({
        operation: "get-user-emotes",
        userId: "validated-user",
        after: longCursor,
      });
      expect(
        manager
          .getAllEmotes()
          .map((item) => item.name)
          .sort()
      ).toEqual(["Kappa", "LimitedWave", "OMEGALUL", "SubWave"]);
    } finally {
      manager.stopCleanupTimer();
    }
  });
});

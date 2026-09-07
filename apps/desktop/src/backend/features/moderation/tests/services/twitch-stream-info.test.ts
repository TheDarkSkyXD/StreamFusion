import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { streamInfoSchema, streamInfoUpdateResultSchema } from "@shared/moderation-types";
import { executeTwitchModViewCommand } from "../../adapters/twitch/twitch-mod-view-reads";
import type { ModerationAccountLease } from "../../adapters/twitch/moderation-account-lease";
import { twitchModViewCommandSchemas } from "../../routes/twitch-mod-view-command-schema";

const lease = (overrides: Partial<ModerationAccountLease> = {}): ModerationAccountLease => ({
  userId: "200",
  accessToken: "main-only",
  scopes: ["channel:manage:broadcast"],
  isCurrent: () => true,
  onCredentialsChanged: () => () => {},
  ...overrides,
});
const read = { operation: "get-stream-info", broadcasterId: "200" } as const;
const update = {
  operation: "update-stream-info",
  broadcasterId: "200",
  settings: { title: "New title" },
} as const;
const channel = {
  broadcaster_id: "200",
  title: "Current title",
  game_id: "42",
  game_name: "Category",
  broadcaster_language: "en",
  tags: ["English"],
  content_classification_labels: ["Gambling", "MatureGame"],
};

describe("Edit Stream Info broadcaster contract", () => {
  it("denies both reads and writes for absent, stale, wrong-actor or insufficient grants before HTTP", async () => {
    const request = vi.fn();
    for (const command of [read, update]) {
      for (const [grant, code] of [
        [null, "unauthorized"],
        [lease({ isCurrent: () => false }), "unauthorized"],
        [lease({ userId: "300" }), "forbidden"],
        [lease({ scopes: ["moderation:read"] }), "missing-scope"],
      ] as const) {
        expect(
          await executeTwitchModViewCommand({ request }, command, async () => grant)
        ).toMatchObject({ ok: false, error: { code } });
      }
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("normalizes the exact channel and offers only API-editable classification labels", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [channel] })
      .mockResolvedValueOnce({
        data: [
          { id: "Gambling", name: "Gambling", description: "Gambling content" },
          { id: "MatureGame", name: "Mature game", description: "Assigned by Twitch" },
        ],
      });
    const result = await executeTwitchModViewCommand({ request }, read, async () => lease());
    expect(result).toEqual({
      ok: true,
      data: {
        broadcasterId: "200",
        title: "Current title",
        category: { id: "42", name: "Category" },
        language: "en",
        tags: ["English"],
        contentClassificationLabels: ["Gambling", "MatureGame"],
        availableContentClassificationLabels: [
          { id: "Gambling", name: "Gambling", description: "Gambling content" },
        ],
      },
    });
    if (result?.ok) expect(streamInfoSchema.safeParse(result.data).success).toBe(true);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/channels?broadcaster_id=200",
      "/content_classification_labels?locale=en-US",
    ]);
  });

  it("maps a partial edit including explicit clears and disabled labels to PATCH and confirms only receipt", async () => {
    const request = vi.fn().mockResolvedValue(null);
    const result = await executeTwitchModViewCommand(
      { request },
      {
        ...update,
        settings: {
          title: "New title",
          categoryId: "",
          language: "other",
          tags: [],
          contentClassificationLabels: [{ id: "Gambling", enabled: false }],
        },
      },
      async () => lease()
    );
    expect(result).toEqual({ ok: true, data: { updated: true } });
    if (result?.ok) expect(streamInfoUpdateResultSchema.safeParse(result.data).success).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith("/channels?broadcaster_id=200", {
      method: "PATCH",
      body: JSON.stringify({
        title: "New title",
        game_id: "",
        broadcaster_language: "other",
        tags: [],
        content_classification_labels: [{ id: "Gambling", is_enabled: false }],
      }),
    });
  });

  it("omits untouched fields and rejects malformed provider success", async () => {
    const request = vi.fn().mockResolvedValue({ accepted: true });
    expect(
      await executeTwitchModViewCommand({ request }, update, async () => lease())
    ).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(request).toHaveBeenCalledExactlyOnceWith("/channels?broadcaster_id=200", {
      method: "PATCH",
      body: '{"title":"New title"}',
    });
  });

  it("rejects account rotation before returning read data or advancing to the catalog request", async () => {
    let current = true;
    const request = vi.fn().mockImplementation(async () => {
      current = false;
      return { data: [channel] };
    });
    expect(
      await executeTwitchModViewCommand({ request }, read, async () =>
        lease({ isCurrent: () => current })
      )
    ).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects absent or mismatched channel data", async () => {
    for (const data of [[], [{ ...channel, broadcaster_id: "300" }]]) {
      const request = vi.fn().mockResolvedValue({ data });
      expect(
        await executeTwitchModViewCommand({ request }, read, async () => lease())
      ).toMatchObject({ ok: false, error: { code: "unavailable" } });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it("bounds requests and rejects native-only fields and non-editable labels at the route", () => {
    const schema = z.discriminatedUnion("operation", twitchModViewCommandSchemas);
    for (const settings of [
      {},
      { title: " " },
      { title: "x".repeat(141) },
      { categoryId: "arbitrary" },
      { language: "english" },
      { tags: ["with space"] },
      { tags: ["x".repeat(26)] },
      { tags: Array.from({ length: 11 }, (_, index) => `tag${index}`) },
      { contentClassificationLabels: [{ id: "MatureGame", enabled: false }] },
      {
        contentClassificationLabels: [
          { id: "Gambling", enabled: true },
          { id: "Gambling", enabled: false },
        ],
      },
      { contentClassificationLabels: [] },
      { goLiveNotification: "hello" },
      { rerun: true },
    ])
      expect(schema.safeParse({ ...update, settings }).success).toBe(false);
    expect(
      schema.safeParse({
        ...update,
        settings: { title: "valid", tags: ["日本語"], categoryId: "0" },
      }).success
    ).toBe(true);
    expect(schema.safeParse({ ...read, broadcasterId: "bad" }).success).toBe(false);
  });
});

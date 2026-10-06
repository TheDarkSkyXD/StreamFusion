import { describe, expect, it, vi } from "vitest";
import {
  createProviderCosmeticsReader,
  parseBttvBadgeCatalog,
  parseFfzBadgeCatalog,
  parseFfzRoleBadges,
  parseSevenTvUserCosmetics,
} from "../adapters/provider-cosmetics";

const target = {
  platform: "twitch",
  channelId: "71092938",
  channelName: "xqc",
} as const;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("third-party chat cosmetics", () => {
  it("parses 7TV v4 active badge and paint with live GraphQL field names", () => {
    const cosmetics = parseSevenTvUserCosmetics({
      style: {
        activeBadge: {
          id: "badge-1",
          name: "Minecraft Event Winner",
          images: [
            {
              url: "https://cdn.7tv.app/badge/badge-1/2x_static.png",
              mime: "image/png",
              scale: 2,
            },
          ],
        },
        activePaint: {
          id: "paint-1",
          data: {
            shadows: [
              {
                offsetX: 1,
                offsetY: 2,
                blur: 3,
                color: { r: 4, g: 5, b: 6, a: 255 },
              },
            ],
            layers: [
              {
                opacity: 1,
                ty: {
                  __typename: "PaintLayerTypeLinearGradient",
                  angle: 90,
                  repeating: false,
                  stops: [
                    { at: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
                    { at: 1, color: { r: 0, g: 0, b: 255, a: 128 } },
                  ],
                },
              },
            ],
          },
        },
      },
    });
    expect(cosmetics).toEqual({
      badges: [
        {
          id: "7tv:badge-1",
          provider: "7tv",
          title: "Minecraft Event Winner",
          imageUrl: "https://cdn.7tv.app/badge/badge-1/2x_static.png",
        },
      ],
      paint: {
        kind: "layers",
        id: "paint-1",
        layers: [
          {
            kind: "linear",
            opacity: 1,
            angle: 90,
            repeat: false,
            stops: [
              { at: 0, color: "rgba(255, 0, 0, 1)" },
              { at: 1, color: "rgba(0, 0, 255, 0.502)" },
            ],
          },
        ],
        shadows: [
          { xOffset: 1, yOffset: 2, radius: 3, color: "rgba(4, 5, 6, 1)" },
        ],
      },
    });
  });

  it("keeps all supported 7TV paint layers in provider order", () => {
    const cosmetics = parseSevenTvUserCosmetics({
      style: {
        activePaint: {
          id: "paint-2",
          data: {
            layers: [
              {
                opacity: 0.5,
                ty: {
                  __typename: "PaintLayerTypeImage",
                  images: [
                    {
                      url: "https://cdn.7tv.app/paint/layer/2x_static.webp",
                      mime: "image/webp",
                      scale: 2,
                    },
                    {
                      url: "https://cdn.7tv.app/paint/layer/2x.webp",
                      mime: "image/webp",
                      scale: 2,
                    },
                  ],
                },
              },
              {
                opacity: 1,
                ty: {
                  __typename: "PaintLayerTypeSingleColor",
                  color: { r: 1, g: 2, b: 3, a: 255 },
                },
              },
              {
                opacity: 0.75,
                ty: {
                  __typename: "PaintLayerTypeRadialGradient",
                  shape: "ELLIPSE",
                  repeating: true,
                  stops: [
                    { at: 0, color: { r: 4, g: 5, b: 6, a: 255 } },
                    { at: 1, color: { r: 7, g: 8, b: 9, a: 255 } },
                  ],
                },
              },
            ],
          },
        },
      },
    });
    expect(cosmetics.paint).toEqual({
      kind: "layers",
      id: "paint-2",
      shadows: [],
      layers: [
        {
          kind: "image",
          opacity: 0.5,
          imageUrl: "https://cdn.7tv.app/paint/layer/2x.webp",
        },
        {
          kind: "linear",
          opacity: 1,
          stops: [
            { at: 0, color: "rgba(1, 2, 3, 1)" },
            { at: 1, color: "rgba(1, 2, 3, 1)" },
          ],
        },
        {
          kind: "radial",
          opacity: 0.75,
          shape: "ellipse",
          repeat: true,
          stops: [
            { at: 0, color: "rgba(4, 5, 6, 1)" },
            { at: 1, color: "rgba(7, 8, 9, 1)" },
          ],
        },
      ],
    });
  });

  it("indexes BTTV and FFZ badge catalogs by Twitch user ID", () => {
    expect(
      parseBttvBadgeCatalog([
        {
          id: "member",
          providerId: "42",
          badge: {
            description: "BTTV Developer",
            svg: "https://cdn.betterttv.net/badges/developer.svg",
          },
        },
      ]).get("42"),
    ).toEqual([
      {
        id: "bttv:member",
        provider: "bttv",
        title: "BTTV Developer",
        imageUrl: "https://cdn.betterttv.net/badges/developer.svg",
      },
    ]);
    expect(
      parseFfzBadgeCatalog({
        badges: [
          {
            id: 5,
            title: "FFZ Developer",
            color: "#ff0000",
            slot: 2,
            urls: {
              "1": "//cdn.frankerfacez.com/badge/5/1",
              "4": "//cdn.frankerfacez.com/badge/5/4",
            },
          },
        ],
        users: { "5": [42] },
      }).get("42"),
    ).toEqual([
      {
        id: "ffz:5",
        provider: "ffz",
        title: "FFZ Developer",
        imageUrl: "https://cdn.frankerfacez.com/badge/5/4",
        slot: 2,
        color: "#ff0000",
      },
    ]);
  });

  it("uses FFZ room moderator and VIP assets only as role replacements", () => {
    expect(
      parseFfzRoleBadges({
        room: {
          mod_urls: {
            "1": "//cdn.frankerfacez.com/badge/mod/1",
            "4": "//cdn.frankerfacez.com/badge/mod/4",
          },
          vip_badge: { "1": "//cdn.frankerfacez.com/badge/vip/1" },
        },
      }),
    ).toEqual([
      {
        id: "ffz:room-moderator",
        provider: "ffz",
        title: "FFZ moderator",
        imageUrl: "https://cdn.frankerfacez.com/badge/mod/4",
        replaces: "moderator",
      },
      {
        id: "ffz:room-vip",
        provider: "ffz",
        title: "FFZ vip",
        imageUrl: "https://cdn.frankerfacez.com/badge/vip/1",
        replaces: "vip",
      },
    ]);
  });

  it("batches distinct 7TV users, reuses inventory, and retains providers after one failure", async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("betterttv")) return response([], 503);
      if (url.includes("frankerfacez"))
        return response({
          badges: [
            {
              id: 5,
              title: "FFZ",
              color: "#fff",
              urls: { "1": "//cdn.frankerfacez.com/badge/5/1" },
            },
          ],
          users: { "5": ["42"] },
        });
      const body = JSON.parse(String(options?.body)) as { query: string };
      expect(body.query).toContain("layers { opacity ty");
      expect(body.query).toContain(
        'u0: userByConnection(platform: TWITCH, platformId: "42")',
      );
      expect(body.query).toContain(
        'u1: userByConnection(platform: TWITCH, platformId: "43")',
      );
      return response({
        data: {
          users: {
            u0: {
              style: {
                activeBadge: {
                  id: "7",
                  name: "7TV",
                  images: [
                    {
                      url: "https://cdn.7tv.app/badge/7/2x_static.png",
                      mime: "image/png",
                      scale: 2,
                    },
                  ],
                },
              },
            },
            u1: null,
          },
        },
      });
    });
    const reader = createProviderCosmeticsReader({
      fetch: fetch as typeof globalThis.fetch,
    });
    const first = await reader.read(
      target,
      ["42", "43", "42"],
      new AbortController().signal,
    );
    expect(first.failures).toEqual(["BTTV"]);
    expect(
      first.byUserId.get("42")?.badges.map((badge) => badge.provider),
    ).toEqual(["7tv", "ffz"]);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("7tv")),
    ).toHaveLength(1);
    await reader.read(target, ["42", "43"], new AbortController().signal);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("7tv")),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/badges/ids")),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/room/xqc")),
    ).toHaveLength(1);
  });

  it("keeps full-style user queries below the live 7TV complexity limit", async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes("betterttv")) return response([]);
      if (url.includes("frankerfacez"))
        return response({ badges: [], users: {} });
      const { query } = JSON.parse(String(options?.body)) as { query: string };
      const aliases = [...query.matchAll(/(u\d+): userByConnection/g)].map(
        (entry) => entry[1],
      );
      expect(aliases.length).toBeLessThanOrEqual(5);
      return response({
        data: {
          users: Object.fromEntries(aliases.map((alias) => [alias, null])),
        },
      });
    });
    const reader = createProviderCosmeticsReader({
      fetch: fetch as typeof globalThis.fetch,
    });
    const result = await reader.read(
      target,
      Array.from({ length: 21 }, (_, index) => String(index + 1)),
      new AbortController().signal,
    );
    expect(result.failures).toEqual([]);
    expect(result.byUserId.size).toBe(21);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("7tv")),
    ).toHaveLength(5);
  });

  it("drops an aborted result before publishing cosmetics", async () => {
    const controller = new AbortController();
    const reader = createProviderCosmeticsReader({
      fetch: async (url) => {
        controller.abort();
        return url.includes("frankerfacez")
          ? response({ badges: [], users: {} })
          : response([]);
      },
    });
    expect(
      (await reader.read(target, ["42"], controller.signal)).byUserId.size,
    ).toBe(0);
  });

  it("treats a missing FFZ room as no role overrides", async () => {
    const reader = createProviderCosmeticsReader({
      fetch: async (url) => {
        if (url.includes("/room/")) return response({}, 404);
        if (url.includes("/badges/ids"))
          return response({ badges: [], users: {} });
        if (url.includes("betterttv")) return response([]);
        return response({ data: { users: { u0: null } } });
      },
    });
    const result = await reader.read(
      target,
      ["42"],
      new AbortController().signal,
    );
    expect(result.failures).toEqual([]);
    expect(result.roleBadges).toEqual([]);
  });

  it("shares an in-flight 7TV batch across overlapping reads", async () => {
    let release: ((value: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async (url: string) =>
      url.includes("7tv")
        ? pending
        : url.includes("frankerfacez")
          ? response(
              url.includes("/room/") ? { room: {} } : { badges: [], users: {} },
            )
          : response([]),
    );
    const reader = createProviderCosmeticsReader({
      fetch: fetch as typeof globalThis.fetch,
    });
    const first = reader.read(target, ["42"], new AbortController().signal);
    const second = reader.read(target, ["42"], new AbortController().signal);
    await Promise.resolve();
    release?.(response({ data: { users: { u0: null } } }));
    await Promise.all([first, second]);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("7tv")),
    ).toHaveLength(1);
  });
});

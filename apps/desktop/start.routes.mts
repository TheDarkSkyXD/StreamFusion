export const startRoutes = {
  type: "root" as const,
  file: "routes/start-root.tsx",
  children: [
    {
      type: "layout" as const,
      id: "_app",
      file: "features/shell/routes/start-layout.tsx",
      children: [
        { type: "index" as const, file: "features/discovery/routes/start-home.tsx" },
        {
          type: "route" as const,
          path: "/following",
          file: "features/discovery/routes/start-following.tsx",
        },
        {
          type: "route" as const,
          path: "/categories",
          file: "features/discovery/routes/start-categories.tsx",
        },
        {
          type: "route" as const,
          path: "/categories/$platform/$categoryId",
          file: "features/discovery/routes/start-category-detail.tsx",
        },
        {
          type: "route" as const,
          path: "/search",
          file: "features/discovery/routes/start-search.tsx",
        },
        {
          type: "route" as const,
          path: "/stream/$platform/$channel",
          file: "features/playback/routes/start-stream.tsx",
        },
        {
          type: "route" as const,
          path: "/video/$platform/$videoId",
          file: "features/playback/routes/start-video.tsx",
        },
        {
          type: "route" as const,
          path: "/settings",
          file: "features/settings/routes/start-settings.tsx",
        },
        {
          type: "route" as const,
          path: "/multistream",
          file: "features/multistream/routes/start-multistream.tsx",
        },
        {
          type: "route" as const,
          path: "/history",
          file: "features/media-library/routes/start-history.tsx",
        },
        {
          type: "route" as const,
          path: "/downloads",
          file: "features/media-library/routes/start-downloads.tsx",
        },
        { type: "route" as const, path: "/mod", file: "features/moderation/routes/start-mod.tsx" },
        {
          type: "route" as const,
          path: "/mod/twitch/$channel",
          file: "features/moderation/routes/start-twitch.tsx",
        },
        {
          type: "route" as const,
          path: "/mod/kick/$channel",
          file: "features/moderation/routes/start-kick.tsx",
        },
      ],
    },
  ],
};

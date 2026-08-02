export type TwitchPlaylistFetchResult =
  | { ok: true; status: number; text: string }
  | {
      ok: false;
      status: number;
      error: "http" | "invalid-request" | "invalid-url" | "network";
    };

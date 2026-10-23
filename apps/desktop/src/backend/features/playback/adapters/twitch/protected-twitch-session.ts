import { gqlGetPlaybackAccessToken } from "./twitch-gql-playback";
import {
  createProtectedTwitchGateway,
  type ProtectedTwitchGateway,
} from "./protected-twitch-gateway";
import type { ProtectedPlayerPreferences } from "@shared/protected-playback-types";
import { preferencesRepository } from "@backend/features/settings/data/preferences-repository";

interface SessionInput {
  channelSlug: string;
  muted: boolean;
  volume: number;
  blockerEnabled: boolean;
  preferences: Partial<ProtectedPlayerPreferences>;
}

export async function createProtectedTwitchSession(
  input: SessionInput
): Promise<ProtectedTwitchGateway> {
  const token = await gqlGetPlaybackAccessToken(input.channelSlug);
  async function authorizationFor(
    access: { value: string; signature: string },
    signal: AbortSignal
  ): Promise<string> {
    const authUrl = new URL(`https://usher.ttvnw.net/api/authxml/${input.channelSlug}`);
    authUrl.searchParams.set("token", access.value);
    authUrl.searchParams.set("sig", access.signature);
    const authorization = await fetch(authUrl, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!authorization.ok)
      throw new Error(`Twitch protected authorization failed: ${authorization.status}`);
    const customdata = await authorization.text();
    if (!customdata || customdata.length > 256 * 1024)
      throw new Error("Invalid Twitch protected authorization");
    return customdata;
  }
  const customdata = await authorizationFor(token, new AbortController().signal);

  function masterFor(access: { value: string; signature: string }): string {
    const masterUrl = new URL(`https://usher.ttvnw.net/api/channel/hls/${input.channelSlug}.m3u8`);
    masterUrl.searchParams.set("token", access.value);
    masterUrl.searchParams.set("sig", access.signature);
    masterUrl.searchParams.set("cdm", "wv");
    masterUrl.searchParams.set("allow_source", "true");
    masterUrl.searchParams.set("allow_audio_only", "true");
    masterUrl.searchParams.set("player_backend", "mediaplayer");
    masterUrl.searchParams.set("playlist_include_framerate", "true");
    masterUrl.searchParams.set("supported_codecs", "h264");
    return masterUrl.href;
  }

  return createProtectedTwitchGateway({
    channelSlug: input.channelSlug,
    masterUrl: masterFor(token),
    customdata,
    refreshAuthorization: async (signal) =>
      authorizationFor(await gqlGetPlaybackAccessToken(input.channelSlug), signal),
    refreshPlayback: async (signal) => {
      const fresh = await gqlGetPlaybackAccessToken(input.channelSlug);
      return { masterUrl: masterFor(fresh), customdata: await authorizationFor(fresh, signal) };
    },
    updateCaptions: (captions) => {
      preferencesRepository.updatePreferences({ captions });
    },
    preferences: input.preferences,
    blockerEnabled: input.blockerEnabled,
    volume: input.volume,
    muted: input.muted,
  });
}

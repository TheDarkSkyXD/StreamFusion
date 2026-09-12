import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FOLLOWED_IDENTITY_REFS,
  followedChannelsBodySchema,
  followedClipsBodySchema,
  followedStreamsBodySchema,
  followedVideosBodySchema,
  parseFollowedIdentityRefs,
} from "@streamfusion/core/relay";

const stream = {
  id: "1",
  platform: "twitch",
  channelId: "c1",
  channelName: "alice",
  channelDisplayName: "Alice",
  channelAvatar: "https://example.com/a.png",
  title: "Live",
  viewerCount: 12,
  thumbnailUrl: "https://example.com/t.png",
  isLive: true,
  startedAt: "2026-09-11T00:00:00.000Z",
  language: "en",
  tags: ["irl"],
};

const channel = {
  id: "c1",
  platform: "twitch",
  username: "alice",
  displayName: "Alice",
  avatarUrl: "https://example.com/a.png",
  isLive: true,
  isVerified: false,
  isPartner: false,
};

const video = {
  id: "video-1",
  platform: "twitch",
  channelId: "c1",
  channelName: "alice",
  channelDisplayName: "Alice",
  channelAvatar: "https://example.com/a.png",
  title: "Past stream",
  thumbnailUrl: "https://example.com/video.jpg",
  duration: 3600,
  viewCount: 1200,
  publishedAt: "2026-08-30T12:00:00.000Z",
  url: "https://example.test/videos/video-1",
  type: "archive",
};

const clip = {
  id: "clip-1",
  platform: "twitch",
  channelId: "c1",
  channelName: "alice",
  channelDisplayName: "Alice",
  channelAvatar: "https://example.com/a.png",
  title: "A clip",
  thumbnailUrl: "https://example.com/clip.jpg",
  clipUrl: "https://example.test/clips/clip-1",
  duration: 30,
  viewCount: 500,
  createdAt: "2026-08-30T12:30:00.000Z",
  creatorName: "viewer",
};

test("followed identity refs accept login-or-id batches up to 100", () => {
  assert.deepEqual(
    parseFollowedIdentityRefs({ ids: ["71092938"], logins: ["PokiMane"] }),
    [
      { kind: "id", value: "71092938" },
      { kind: "login", value: "pokimane" },
    ],
  );
  assert.equal(parseFollowedIdentityRefs({ ids: [], logins: [] }), null);
  assert.equal(
    parseFollowedIdentityRefs({
      ids: Array.from(
        { length: MAX_FOLLOWED_IDENTITY_REFS + 1 },
        (_, i) => `${i + 1}`,
      ),
      logins: [],
    }),
    null,
  );
});

test("followed streams and channels keep missing refs without extra fields", () => {
  const missing = [{ kind: "login", value: "offline" }];
  assert.equal(
    followedStreamsBodySchema.is({
      platform: "twitch",
      streams: [stream],
      missing,
    }),
    true,
  );
  assert.equal(
    followedChannelsBodySchema.is({
      platform: "kick",
      channels: [channel],
      missing: [{ kind: "id", value: "411439" }],
    }),
    true,
  );
  assert.equal(
    followedStreamsBodySchema.is({
      platform: "twitch",
      streams: [{ ...stream, helixUserId: "extra" }],
      missing: [],
    }),
    false,
  );
});

test("unsupported recorded bodies are success payloads with empty items and no cursor", () => {
  assert.equal(
    followedVideosBodySchema.is({
      platform: "kick",
      channelId: "411439",
      supported: false,
      videos: [],
    }),
    true,
  );
  assert.equal(
    followedClipsBodySchema.is({
      platform: "kick",
      channelId: "411439",
      supported: false,
      clips: [],
      cursor: "after:1",
    }),
    false,
  );
  assert.equal(
    followedVideosBodySchema.is({
      platform: "twitch",
      channelId: "c1",
      supported: true,
      videos: [video],
      cursor: "after:1",
    }),
    true,
  );
  assert.equal(
    followedClipsBodySchema.is({
      platform: "twitch",
      channelId: "c1",
      supported: true,
      clips: [clip],
    }),
    true,
  );
});

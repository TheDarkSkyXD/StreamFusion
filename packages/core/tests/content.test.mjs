import assert from "node:assert/strict";
import test from "node:test";

import {
  categorySchema,
  channelSchema,
  clipSchema,
  streamSchema,
  toSerializedTimestamp,
  videoSchema,
} from "@streamfusion/core/content";
import { contentFixtures as content } from "@streamfusion/core/testing";

const cases = [
  ["stream", streamSchema],
  ["channel", channelSchema],
  ["category", categorySchema],
  ["video", videoSchema],
  ["clip", clipSchema],
];

test("normalized content contracts survive JSON serialization", () => {
  for (const [name, schema] of cases) {
    const roundTrip = JSON.parse(JSON.stringify(content[name]));
    assert.equal(schema.is(roundTrip), true, `${name} failed its schema`);
    assert.deepEqual(roundTrip, content[name]);
  }
});

test("normalized recorded content retains portable category identity", () => {
  assert.equal(
    videoSchema.is({
      ...content.video,
      categoryId: "509658",
      categoryName: "Just Chatting",
    }),
    true,
  );
  assert.equal(
    clipSchema.is({
      ...content.clip,
      categoryId: "509658",
      categoryName: "Just Chatting",
    }),
    true,
  );
});

test("content schemas reject non-serialized timestamps", () => {
  assert.equal(
    streamSchema.is({ ...content.stream, startedAt: new Date() }),
    false,
  );
  assert.equal(
    videoSchema.is({ ...content.video, publishedAt: "2026-08-30" }),
    false,
  );
  assert.throws(
    () => toSerializedTimestamp("2026-08-30"),
    /canonical UTC ISO string/,
  );
});

test("content schemas reject provider and presentation leakage", () => {
  assert.equal(
    channelSchema.is({ ...content.channel, chatroomId: 123 }),
    false,
  );
  assert.equal(
    channelSchema.is({ ...content.channel, kickUserId: "456" }),
    false,
  );
  assert.equal(
    categorySchema.is({ ...content.category, slug: "just-chatting" }),
    false,
  );
  assert.equal(
    clipSchema.is({ ...content.clip, embedUrl: "https://player.example" }),
    false,
  );
  assert.equal(videoSchema.is({ ...content.video, language: "en" }), false);
  assert.equal(clipSchema.is({ ...content.clip, vodId: "video-1" }), false);
});

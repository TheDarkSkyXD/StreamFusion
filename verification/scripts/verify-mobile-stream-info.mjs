import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const evidence = new URL("../evidence/mobile-stream-info/", import.meta.url);
const read = async (state) =>
  JSON.parse(await readFile(new URL(`native-${state}.json`, evidence), "utf8"));
const find = (nodes, id) => nodes.find((node) => node.identifier === id);
const requireNode = (nodes, id) => {
  const node = find(nodes, id);
  assert.ok(node, `Missing native element: ${id}`);
  return node.coordinates;
};
const expanded = await read("expanded");
const collapsed = await read("collapsed");
const following = await read("following");
const fullscreen = await read("fullscreen");

for (const [state, nodes] of [
  ["expanded", expanded],
  ["following", following],
]) {
  for (const id of [
    "watch-channel-expanded",
    "watch-stream-title",
    "watch-info-category",
    "watch-info-tags",
    "watch-channel-avatar",
  ])
    requireNode(nodes, id);
  const card = requireNode(nodes, "watch-channel-chrome");
  const chat = requireNode(nodes, "watch-chat");
  const follow = requireNode(nodes, "watch-follow");
  const subscribe = requireNode(nodes, "watch-subscribe");
  assert.ok(chat.y >= card.y + card.height, `${state}: chat overlaps the card`);
  assert.equal(
    follow.y,
    subscribe.y,
    `${state}: actions are on different rows`,
  );
  assert.equal(follow.height, subscribe.height);
  assert.ok(
    Math.abs(follow.width - subscribe.width) <= 5,
    `${state}: actions differ by more than 2dp at this density`,
  );
  console.log(
    `${state}: chat below card; action widths ${follow.width}px / ${subscribe.width}px`,
  );
}
assert.equal(find(collapsed, "watch-channel-expanded"), undefined);
assert.equal(find(collapsed, "watch-stream-title"), undefined);
requireNode(collapsed, "watch-chat");
requireNode(collapsed, "watch-player");
requireNode(fullscreen, "watch-player");
assert.equal(find(fullscreen, "watch-channel-chrome"), undefined);
assert.equal(find(fullscreen, "watch-chat"), undefined);
assert.equal(find(following, "watch-follow")?.selected, true);
console.log(
  "Collapsed chat and fullscreen presentation verified from saved Android hierarchies.",
);

const crop = { left: 0, top: 671, width: 1080, height: 487 };
const pixels = async (file) =>
  sharp(await readFile(new URL(file, evidence)))
    .extract(crop)
    .ensureAlpha()
    .raw()
    .toBuffer();
const reference = await pixels("twitch-tap-1s.png");
const actual = await pixels("after-expanded.png");
let different = 0;
for (let i = 0; i < reference.length; i += 4) {
  if (
    reference[i] !== actual[i] ||
    reference[i + 1] !== actual[i + 1] ||
    reference[i + 2] !== actual[i + 2]
  )
    different++;
}
console.log(
  `Reference pixel parity: ${different === 0 ? "PASS" : "FAIL"}; ${different}/${reference.length / 4} RGB pixels differ (${((different / (reference.length / 4)) * 100).toFixed(2)}%).`,
);

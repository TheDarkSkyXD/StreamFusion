import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(
  new URL("../src/features/auth/components/twitch-accounts-panel.tsx", import.meta.url),
  "utf8",
);
const shell = await readFile(
  new URL("../src/features/shell/components/app-shell.tsx", import.meta.url),
  "utf8",
);
const runtime = await readFile(
  new URL("../src/composition/mobile-runtime.tsx", import.meta.url),
  "utf8",
);

test("Twitch Accounts uses one canonical action vocabulary", () => {
  for (const control of [
    "connect-account",
    "manage-account",
    "disconnect-account",
    "copy-account-code",
    "open-account-verification",
    "cancel-account-connect",
    "retry-account-connect",
  ])
    assert.match(panel, new RegExp(`"${control}"`));
  assert.doesNotMatch(panel, /account-(?:add|manage)/);
});

test("disconnect copy is targeted and preserves unrelated local data", () => {
  assert.match(panel, /Disconnect Twitch account/);
  assert.match(panel, /Guest Follows, History, Activity, settings, media, and other accounts stay intact/);
});

test("the account avatar opens More instead of bypassing its parent", () => {
  const header = shell.slice(shell.indexOf("function ShellHeader"), shell.indexOf("function ShellScreen"));
  assert.match(header, /location: \{ route: "more" \}/);
  assert.doesNotMatch(header, /more\/accounts/);
});

test("the development fixture is explicit and normal missing configuration stays unavailable", () => {
  assert.match(runtime, /useState\(false\)/);
  assert.match(runtime, /__DEV__ && twitchClientId === null/);
  assert.match(panel, /Development fixture — not a live Twitch account/);
  assert.match(panel, /development-twitch-auth-fixture/);
  assert.match(panel, /exit-development-twitch-auth-fixture/);
});

test("Accounts uses the shared contained and restorable screen scroll contract", () => {
  const accounts = shell.slice(
    shell.indexOf('location.route === "more/accounts"'),
    shell.indexOf("\n  return (\n    <ScrollView", shell.indexOf('location.route === "more/accounts"')),
  );
  assert.match(accounts, /contentInsetAdjustmentBehavior="automatic"/);
  assert.match(accounts, /ref=\{scrollView\}/);
  assert.match(accounts, /style=\{styles\.screenScroll\}/);
  assert.match(accounts, /styles\.contentColumn/);
});

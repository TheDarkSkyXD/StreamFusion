import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(path.join(dir, name), "utf8");
const cases = [
  ["twitch", "FirstTourGuardsman", "retry-network-restored-before.xml"],
  ["kick", "Absi", "retry-kick-restored-before.xml"],
];

for (const [provider, channel, beforeFile] of cases) {
  const before = read(beforeFile);
  const offline = read(`retry-${provider}-offline-after.xml`);
  const restored = read(`retry-${provider}-restored-after.xml`);
  for (const [label, xml] of [["before", before], ["offline", offline], ["restored", restored]]) {
    assert(xml.includes(`text="${channel}"`), `${provider} ${label} target differs`);
  }
  assert(before.includes('text="Playback stopped"'), `${provider} baseline did not stop`);
  assert(!offline.includes('text="Playback stopped"'), `${provider} stopped during retry`);
  assert(!restored.includes('text="Playback stopped"'), `${provider} failed after reconnection`);
  assert(!restored.includes('text="You are offline"'), `${provider} connectivity not restored`);
  console.log(`${provider} saved UI evidence passed`);
}

assert(read("retry-policy-before.xml").includes('failures="5"'), "retry baseline did not fail");
assert(read("retry-policy-after.xml").includes('failures="0"'), "retry regressions did not pass");
assert(read("retry-caption-after.xml").includes('failures="0"'), "playback lifecycle did not pass");
console.log("retry and lifecycle regression evidence passed");

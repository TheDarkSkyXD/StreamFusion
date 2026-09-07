import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { prepareRelocation } from "../../scripts/relocate-feature-files.mjs";
const manifests = ["renderer-apply", "backend-map", "renderer-final-moves", "playback-root-moves"];
const mapping = new Map();
for (const manifest of manifests) {
  const value = JSON.parse(fs.readFileSync(`.scratch/feature-migration/${manifest}.json`, "utf8"));
  for (const move of value.moves ?? value) if (move.from !== move.to) mapping.set(move.from, move.to);
}
const moves = [];
for (const [from, destination] of mapping) {
  let to = destination;
  const visited = new Set([from]);
  while (mapping.has(to) && !visited.has(to)) { visited.add(to); to = mapping.get(to); }
  if (!fs.existsSync(from) && fs.existsSync(to)) moves.push({ from, to });
}
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "apps/desktop", ".agents/skills/verify-streamfusion"], { encoding: "utf8" }).split("\0").filter((file) => file && fs.existsSync(file));
const scope = files.filter((file) => !file.includes("/src/backend/") && !file.includes("/tests/backend/") && !file.includes("/src/frontend/features/"));
const repair = prepareRelocation(process.cwd(), moves, files, { repair: true, rewriteFiles: scope });
repair.apply();
fs.writeFileSync(".scratch/feature-migration/desktop-combined-moves.json", JSON.stringify({ moves }, null, 2) + "\n");
console.log(`Repaired ${repair.changes.length} external consumers`);

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prepareRelocation } from "../../scripts/relocate-feature-files.mjs";

const root = path.resolve(".");
const list = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const known = [...new Set([...list(["ls-files", "-z"]), ...list(["ls-files", "--others", "--exclude-standard", "-z"])])]
  .filter((file) => fs.existsSync(path.join(root, file)));
const scope = known.filter((file) => file.startsWith("apps/desktop/src/backend/") || file.startsWith("apps/desktop/tests/backend/"));
const relocation = prepareRelocation(root, [{
  from: "apps/desktop/src/backend/features/chat/domain/subscriber-eligibility.ts",
  to: "apps/desktop/src/backend/features/chat/adapters/platform/subscriber-eligibility.ts",
}], known, { repair: true, rewriteFiles: scope });
process.stdout.write(`${relocation.moves.length} moves; ${relocation.changes.length} repairs.\n`);
relocation.apply();

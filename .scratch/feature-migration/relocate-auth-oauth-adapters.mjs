import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prepareRelocation } from "../../scripts/relocate-feature-files.mjs";

const root = path.resolve(".");
const listed = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const known = [...new Set([...listed(["ls-files", "-z"]), ...listed(["ls-files", "--others", "--exclude-standard", "-z"])])]
  .filter((file) => fs.existsSync(path.join(root, file)));
const scope = known.filter((file) => file.startsWith("apps/desktop/src/backend/") || file.startsWith("apps/desktop/tests/backend/"));
const relocation = prepareRelocation(root, [
  {
    from: "apps/desktop/src/backend/features/authentication/composition/oauth-config.ts",
    to: "apps/desktop/src/backend/features/authentication/adapters/oauth/oauth-config.ts",
  },
  {
    from: "apps/desktop/src/backend/features/authentication/domain/token-exchange.ts",
    to: "apps/desktop/src/backend/features/authentication/adapters/oauth/token-exchange.ts",
  },
], known, { repair: true, rewriteFiles: scope });
process.stdout.write(`${relocation.moves.length} moves; ${relocation.changes.length} import repairs.\n`);
relocation.apply();

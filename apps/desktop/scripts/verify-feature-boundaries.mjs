import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedFixture = path.join(
  desktopRoot,
  "src/frontend/features/auth/feature-boundary-allowed.ts"
);
const forbiddenFixture = path.join(
  desktopRoot,
  "src/frontend/features/auth/feature-boundary-forbidden.ts"
);
const eslintBin = path.join(desktopRoot, "node_modules/eslint/bin/eslint.js");

async function lint(file) {
  return run(process.execPath, [eslintBin, file, "--no-warn-ignored"], {
    cwd: desktopRoot,
  });
}

try {
  await fs.writeFile(allowedFixture, 'import "@/features/moderation";\n');
  await fs.writeFile(forbiddenFixture, 'import "@/features/playback";\n');

  await lint(allowedFixture);

  try {
    await lint(forbiddenFixture);
    throw new Error("The forbidden auth-to-playback dependency unexpectedly passed ESLint.");
  } catch (error) {
    if (error.message.startsWith("The forbidden")) throw error;
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    if (!output.includes("boundaries/dependencies")) throw error;
  }

  process.stdout.write(
    "Feature boundary proof passed: allowed edge accepted, forbidden edge rejected.\n"
  );
} finally {
  await Promise.all([
    fs.rm(allowedFixture, { force: true }),
    fs.rm(forbiddenFixture, { force: true }),
  ]);
}

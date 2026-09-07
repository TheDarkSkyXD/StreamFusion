import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareRelocation } from "./relocate-feature-files.mjs";

test("relocation preserves aliases, mocks, relative dependencies, assets, and NodeNext imports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sf-feature-move-"));
  try {
    const files = {
      "apps/desktop/src/frontend/hooks/example.ts": `import { x } from '@/lib/value';\nimport { y } from '../lib/other.js';\nvi.mock('@/lib/value');\nnew URL('../lib/asset.svg', import.meta.url);\nnew URL('../lib/value', 'https://example.com/');\nconst label = '../lib/value';\n`,
      "apps/desktop/src/frontend/lib/value.ts": "export const x = 1;",
      "apps/desktop/src/frontend/lib/other.ts": "export const y = 2;",
      "apps/desktop/src/frontend/lib/asset.svg": "<svg/>",
      "apps/desktop/src/frontend/routes/route.ts":
        "export { default } from '../pages/Home';",
      "apps/desktop/src/frontend/pages/Home/index.tsx":
        "export default function Home() {}",
      "apps/desktop/src/frontend/auth/index.ts": "export const auth = 1;",
      "apps/desktop/src/frontend/routes/auth.ts":
        "export { auth } from '../auth';",
    };
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    const moves = [
      {
        from: "apps/desktop/src/frontend/hooks/example.ts",
        to: "apps/desktop/src/frontend/features/example/components/example.ts",
      },
      {
        from: "apps/desktop/src/frontend/lib/value.ts",
        to: "apps/desktop/src/frontend/features/example/domain/value.ts",
      },
      {
        from: "apps/desktop/src/frontend/pages/Home/index.tsx",
        to: "apps/desktop/src/frontend/features/example/components/Home/index.tsx",
      },
      {
        from: "apps/desktop/src/frontend/auth/index.ts",
        to: "apps/desktop/src/frontend/features/example/composition/auth-runtime.ts",
      },
    ];
    const relocation = prepareRelocation(root, moves, Object.keys(files));
    assert.equal(fs.existsSync(path.join(root, moves[0].to)), false);
    relocation.apply();
    const output = fs.readFileSync(path.join(root, moves[0].to), "utf8");
    assert.match(output, /from '@\/features\/example\/domain\/value'/);
    assert.match(output, /vi.mock\('@\/features\/example\/domain\/value'\)/);
    assert.match(output, /from '\.\.\/\.\.\/\.\.\/lib\/other.js'/);
    assert.match(output, /new URL\('\.\.\/\.\.\/\.\.\/lib\/asset.svg'/);
    assert.match(output, /const label = '\.\.\/lib\/value'/);
    assert.match(
      output,
      /new URL\('\.\.\/lib\/value', 'https:\/\/example.com\/'\)/,
    );
    assert.equal(
      fs.readFileSync(
        path.join(root, "apps/desktop/src/frontend/routes/route.ts"),
        "utf8",
      ),
      "export { default } from '../features/example/components/Home';",
    );
    assert.equal(
      fs.readFileSync(
        path.join(root, "apps/desktop/src/frontend/routes/auth.ts"),
        "utf8",
      ),
      "export { auth } from '../features/example/composition/auth-runtime';",
    );
    assert.equal(
      prepareRelocation(
        root,
        moves,
        Object.keys(files).map(
          (file) => moves.find(({ from }) => from === file)?.to ?? file,
        ),
      ).moves.length,
      0,
    );
    fs.writeFileSync(
      path.join(root, moves[0].to),
      "import { y } from '../lib/other.js';",
    );
    const currentFiles = Object.keys(files).map(
      (file) => moves.find(({ from }) => from === file)?.to ?? file,
    );
    prepareRelocation(root, moves, currentFiles, {
      repair: true,
      rewriteFiles: [moves[0].to],
    }).apply();
    assert.equal(
      fs.readFileSync(path.join(root, moves[0].to), "utf8"),
      "import { y } from '../../../lib/other.js';",
    );
    assert.throws(
      () =>
        prepareRelocation(
          root,
          [{ from: moves[0].to, to: "../escape.ts" }],
          [],
        ),
      /escapes repository/,
    );
    assert.throws(
      () =>
        prepareRelocation(root, [{ from: moves[0].to, to: moves[1].to }], []),
      /exactly one/,
    );
  } finally {
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
});

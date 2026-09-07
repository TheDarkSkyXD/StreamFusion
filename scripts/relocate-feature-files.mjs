import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const slash = (value) => value.split(path.sep).join("/");
const extensions = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

export function prepareRelocation(root, moves, files, options = {}) {
  const inside = (relative) => {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new Error(`Path escapes repository: ${relative}`);
    }
    return absolute;
  };
  const destinations = new Set();
  const mapping = new Map();
  for (const { from, to } of moves) {
    const source = inside(from);
    const destination = inside(to);
    if (
      (!options.repair && destinations.has(destination)) ||
      mapping.has(source)
    )
      throw new Error(`Duplicate move: ${from} -> ${to}`);
    destinations.add(destination);
    if (source === destination) throw new Error(`Unnecessary move: ${from}`);
    const sourceExists = fs.existsSync(source);
    const destinationExists = fs.existsSync(destination);
    if (sourceExists === destinationExists)
      throw new Error(`Expected exactly one existing path: ${from} -> ${to}`);
    if (sourceExists || options.repair) mapping.set(source, destination);
  }
  const known = new Set([
    ...files.map(inside),
    ...mapping.keys(),
    ...mapping.values(),
  ]);
  const originalImporters = new Map(
    [...mapping].map(([from, to]) => [to, from]),
  );
  const resolve = (candidate) => {
    for (const extension of extensions) {
      const file = path.normalize(candidate + extension);
      if (known.has(file)) return { file, extension };
    }
    if (/\.js$/.test(candidate)) {
      for (const extension of [".ts", ".tsx"]) {
        const file = candidate.slice(0, -3) + extension;
        if (known.has(file)) return { file, extension: "node-next" };
      }
    }
    return undefined;
  };
  const rewrite = (specifier, importer) => {
    const suffixOffset = specifier.search(/[?#]/);
    const bare =
      suffixOffset < 0 ? specifier : specifier.slice(0, suffixOffset);
    const suffix = suffixOffset < 0 ? "" : specifier.slice(suffixOffset);
    const aliases =
      options.aliases ??
      (importer.includes(`${path.sep}desktop${path.sep}`)
        ? [
            ["@/", "apps/desktop/src/frontend"],
            ["@frontend/", "apps/desktop/src/frontend"],
            ["@backend/", "apps/desktop/src/backend"],
            ["@shared/", "apps/desktop/src/shared"],
          ]
        : importer.includes(`${path.sep}mobile${path.sep}`)
          ? [
              ["@/", "apps/mobile/src"],
              ["@mobile/", "apps/mobile/src"],
            ]
          : importer.includes(`${path.sep}core${path.sep}`)
            ? [["@core/", "packages/core/src"]]
            : []);
    const alias = aliases.find(([prefix]) => bare.startsWith(prefix));
    const relative =
      bare === "." ||
      bare === ".." ||
      bare.startsWith("./") ||
      bare.startsWith("../");
    if (!alias && !relative) return specifier;
    let candidate = alias
      ? path.resolve(root, alias[1], bare.slice(alias[0].length))
      : path.resolve(path.dirname(importer), bare);
    let resolved = resolve(candidate);
    if (options.repair && resolved && fs.existsSync(resolved.file))
      return specifier;
    if (options.repair && relative && originalImporters.has(importer)) {
      candidate = path.resolve(
        path.dirname(originalImporters.get(importer)),
        bare,
      );
      resolved = resolve(candidate);
    }
    if (!resolved) return specifier;
    const target = mapping.get(resolved.file) ?? resolved.file;
    const newImporter = mapping.get(importer) ?? importer;
    if (
      !options.repair &&
      target === resolved.file &&
      (alias || newImporter === importer)
    )
      return specifier;
    let styled = target;
    if (resolved.extension === "node-next")
      styled = target.replace(/\.tsx?$/, ".js");
    else if (resolved.extension.startsWith("/index"))
      styled = /^index\.[^.]+$/.test(path.basename(target))
        ? path.dirname(target)
        : target.replace(/\.[^.]+$/, "");
    else if (resolved.extension)
      styled = target.slice(0, -resolved.extension.length);
    if (alias)
      return (
        alias[0] +
        slash(path.relative(path.resolve(root, alias[1]), styled)) +
        suffix
      );
    const result = slash(path.relative(path.dirname(newImporter), styled));
    return (result.startsWith(".") ? result : `./${result}`) + suffix;
  };
  const changes = [];
  for (const relative of options.rewriteFiles ?? files) {
    if (!/\.[cm]?[jt]sx?$/.test(relative)) continue;
    const file = inside(relative);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      before,
      ts.ScriptTarget.Latest,
      true,
    );
    const replacements = [];
    const visit = (node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        const parent = node.parent;
        const moduleDeclaration =
          (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node;
        const moduleType =
          ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent);
        const moduleCall =
          ts.isCallExpression(parent) &&
          parent.arguments[0] === node &&
          (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(parent.expression) &&
              parent.expression.text === "require") ||
            (ts.isPropertyAccessExpression(parent.expression) &&
              [
                "mock",
                "doMock",
                "unmock",
                "doUnmock",
                "importActual",
                "importMock",
              ].includes(parent.expression.name.text)));
        const assetUrl =
          ts.isNewExpression(parent) &&
          ts.isIdentifier(parent.expression) &&
          parent.expression.text === "URL" &&
          parent.arguments?.[0] === node &&
          parent.arguments[1]?.getText(source) === "import.meta.url";
        if (moduleDeclaration || moduleType || moduleCall || assetUrl) {
          const updated = rewrite(node.text, file);
          if (updated !== node.text)
            replacements.push({
              start: node.getStart(source) + 1,
              end: node.end - 1,
              updated,
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    let after = before;
    for (const { start, end, updated } of replacements.sort(
      (a, b) => b.start - a.start,
    )) {
      after = after.slice(0, start) + updated + after.slice(end);
    }
    if (before !== after)
      changes.push({ file: mapping.get(file) ?? file, content: after });
  }
  return {
    moves: [...mapping]
      .filter(([from]) => fs.existsSync(from))
      .map(([from, to]) => ({ from, to })),
    changes,
    apply() {
      for (const [from, to] of mapping) {
        if (!fs.existsSync(from)) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
      }
      for (const { file, content } of changes) fs.writeFileSync(file, content);
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const manifestPath = process.argv[2];
  if (!manifestPath)
    throw new Error(
      "Usage: node scripts/relocate-feature-files.mjs manifest.json [--apply]",
    );
  const { moves } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const relocation = prepareRelocation(root, moves, files);
  process.stdout.write(
    `${relocation.moves.length} file moves; ${relocation.changes.length} import rewrites.\n`,
  );
  if (process.argv.includes("--apply")) relocation.apply();
}

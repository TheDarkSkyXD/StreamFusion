import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const localeDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/frontend/i18n/locales"
);
const languageRegistryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/shared/display-language.ts"
);
const registrySource = await readFile(languageRegistryPath, "utf8");
const registeredLanguages = [...registrySource.matchAll(/\bcode:\s*"([^"]+)"/g)].map(
  (match) => match[1]
);

const allowedSharedValues = new Set([
  "7TV",
  "API",
  "Auto",
  "BTTV",
  "Chat",
  "Chromium",
  "Clip",
  "Clips",
  "Discord",
  "Emojis",
  "Error",
  "EventSub",
  "FFZ",
  "FPS",
  "GIF",
  "General",
  "GitHub",
  "Global",
  "HEVC",
  "HLS",
  "IRC",
  "Kick",
  "Linux",
  "macOS",
  "MultiChat",
  "MultiStream",
  "Normal",
  "normal",
  "NightOwl",
  "NightOwl:",
  "OAuth",
  "PaintedPixel:",
  "Proxy",
  "Raid",
  "StreamFusion",
  "Twitch",
  "VIP",
  "VIPs",
  "Windows",
  "cURL",
  "thunderdome",
  "v",
  "DeepViolet:",
  "{{value}}/s",
]);

function catalogStrings(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const strings = new Map();

  function unwrapExpression(node) {
    let current = node;
    while (
      ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }

  function visitObject(node, path = []) {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = property.name.getText(sourceFile).replace(/^["']|["']$/g, "");
      const nextPath = [...path, name];
      const initializer = unwrapExpression(property.initializer);
      if (ts.isObjectLiteralExpression(initializer)) {
        visitObject(initializer, nextPath);
      } else if (
        ts.isStringLiteral(initializer) ||
        ts.isNoSubstitutionTemplateLiteral(initializer)
      ) {
        strings.set(nextPath.join("."), initializer.text);
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      const initializer = unwrapExpression(declaration.initializer);
      if (ts.isObjectLiteralExpression(initializer)) {
        visitObject(initializer);
      }
    }
  }

  return strings;
}

function isSuspiciousSharedValue(value) {
  if (allowedSharedValues.has(value)) return false;
  const withoutPlaceholders = value.replace(/{{[^}]+}}/g, " ").trim();
  if (!withoutPlaceholders) return false;
  if (/^\d+(?:p|p\d+|h)(?:\s*\/\s*\d+K)?$/i.test(withoutPlaceholders)) return false;
  if (/^\d+px$/i.test(withoutPlaceholders)) return false;
  if (/^[ms]$/i.test(withoutPlaceholders)) return false;
  return /[A-Za-z]/.test(withoutPlaceholders);
}

function interpolationVariables(value) {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)].map((match) => match[1]).sort();
}

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? listTypeScriptFiles(path)
        : entry.name.endsWith(".ts")
          ? [path]
          : [];
    })
  );
  return files.flat();
}

const rootFiles = (await readdir(localeDirectory)).filter((file) => file.endsWith(".ts"));
const localeFiles = await listTypeScriptFiles(localeDirectory);
const sources = await Promise.all(
  localeFiles.map(async (file) => ({ file, source: await readFile(file, "utf8") }))
);
const errors = sources.flatMap(({ file, source }) => {
  const empty = [...source.matchAll(/:\s*["']\s*["']/g)].map((match) => match.index);
  const encodedEntity = /&(quot|apos|amp|lt|gt);/.exec(source);
  return [
    ...(empty.length ? [`${file} contains an empty translation at character ${empty[0]}`] : []),
    ...(encodedEntity
      ? [`${file} contains an HTML entity at character ${encodedEntity.index}`]
      : []),
  ];
});
const catalogLanguages = rootFiles
  .map((file) => file.replace(/\.ts$/, ""))
  .filter((language) => registeredLanguages.includes(language));
const missingCatalogs = registeredLanguages.filter(
  (language) => !catalogLanguages.includes(language)
);
if (missingCatalogs.length) errors.push(`Missing locale catalogs: ${missingCatalogs.join(", ")}`);

const baseModules = (await readdir(join(localeDirectory, "en")))
  .filter((file) => file.endsWith(".ts"))
  .sort();
for (const language of registeredLanguages.filter((language) => language !== "en")) {
  const translationModules = (await readdir(join(localeDirectory, language)))
    .filter((file) => file.endsWith(".ts"))
    .sort();
  const missing = baseModules.filter((file) => !translationModules.includes(file));
  const extra = translationModules.filter((file) => !baseModules.includes(file));
  if (missing.length) errors.push(`${language} is missing locale modules: ${missing.join(", ")}`);
  if (extra.length) errors.push(`${language} has extra locale modules: ${extra.join(", ")}`);

  for (const file of baseModules.filter((moduleFile) => translationModules.includes(moduleFile))) {
    const basePath = join(localeDirectory, "en", file);
    const translationPath = join(localeDirectory, language, file);
    const baseStrings = catalogStrings(await readFile(basePath, "utf8"), basePath);
    const translationStrings = catalogStrings(
      await readFile(translationPath, "utf8"),
      translationPath
    );
    for (const [key, value] of baseStrings) {
      const translatedValue = translationStrings.get(key);
      if (translatedValue === undefined) continue;
      const baseVariables = interpolationVariables(value);
      const translationVariables = interpolationVariables(translatedValue);
      if (baseVariables.join("\0") !== translationVariables.join("\0")) {
        errors.push(
          `${language}/${file}:${key} changes interpolation variables from ${JSON.stringify(baseVariables)} to ${JSON.stringify(translationVariables)}`
        );
      }
      if (translatedValue === value && isSuspiciousSharedValue(value)) {
        errors.push(`${language}/${file}:${key} still matches English: ${JSON.stringify(value)}`);
      }
    }
  }
}

for (const language of registeredLanguages) {
  const aggregator = await readFile(join(localeDirectory, `${language}.ts`), "utf8");
  for (const file of baseModules) {
    const moduleName = file.replace(/\.ts$/, "");
    if (!aggregator.includes(`./${language}/${moduleName}`)) {
      errors.push(`${language}.ts does not aggregate ${language}/${file}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}

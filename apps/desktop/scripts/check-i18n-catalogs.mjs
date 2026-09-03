import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const localeDirectory = join(scriptDirectory, "../src/frontend/i18n/locales");
const generatedDirectory = join(localeDirectory, "generated");
const loaderPath = join(scriptDirectory, "../src/frontend/i18n/catalog-loaders.generated.ts");
const registryPath = join(scriptDirectory, "../src/shared/display-language.ts");
const sourceSnapshotPath = join(scriptDirectory, "i18n-source-snapshot.generated.json");
const shouldGenerate = process.argv.includes("--generate");
const registrySource = await readFile(registryPath, "utf8");
const registeredLanguages = [...registrySource.matchAll(/\bcode:\s*"([^"]+)"/g)].map(
  (match) => match[1]
);
const generatedLanguages = registeredLanguages.filter(
  (language) => language !== "en" && language !== "es"
);
const googleLanguageAliases = new Map([
  ["fil", "tl"],
  ["he", "iw"],
  ["nb", "no"],
]);
const protectedPattern =
  /{{[^}]+}}|https?:\/\/[^\s"')]+|\b(?:Chromium DevTools|StreamFusion(?:['’]s)?|Twitch(?:['’]s)?|Kick(?:['’]s)?|7TV|BTTV|FFZ|OAuth|EventSub|Chromium|Discord|GitHub|Linux|Windows|macOS|HLS|HEVC|IRC|FPS|GIF|API|VIPs?)\b/g;
const protectedValuePattern =
  /https?:\/\/[^\s"')]+|\b(?:StreamFusion|Twitch|Kick|7TV|BTTV|FFZ|Chromium|Discord|GitHub|Windows|macOS)\b/g;
let nextGoogleRequestAt = 0;

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

function propertyName(property, sourceFile) {
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  throw new Error(`${sourceFile.fileName} has an unsupported computed catalog key`);
}

function catalogValue(node, sourceFile) {
  const value = unwrapExpression(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return value.text;
  }
  if (!ts.isObjectLiteralExpression(value)) {
    throw new Error(
      `${sourceFile.fileName} has a non-string catalog value at ${value.getStart(sourceFile)}`
    );
  }

  return Object.fromEntries(
    value.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`${sourceFile.fileName} has an unsupported catalog property`);
      }
      return [propertyName(property, sourceFile), catalogValue(property.initializer, sourceFile)];
    })
  );
}

async function sourceCatalog(language) {
  const moduleDirectory = join(localeDirectory, language);
  const moduleFiles = (await readdir(moduleDirectory))
    .filter((file) => file.endsWith(".ts"))
    .sort();
  const catalog = {};

  for (const file of moduleFiles) {
    const filePath = join(moduleDirectory, file);
    const source = await readFile(filePath, "utf8");
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const declaration = sourceFile.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((candidate) => candidate.initializer);
    if (!declaration?.initializer) throw new Error(`${filePath} has no catalog object`);
    const moduleCatalog = catalogValue(declaration.initializer, sourceFile);
    for (const [key, value] of Object.entries(moduleCatalog)) {
      if (key in catalog) throw new Error(`Duplicate top-level catalog key: ${key}`);
      catalog[key] = value;
    }
  }

  return catalog;
}

function flattenCatalog(value, prefix = "", result = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") result.set(path, child);
    else if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenCatalog(child, path, result);
    } else {
      result.set(path, child);
    }
  }
  return result;
}

function setCatalogValue(catalog, path, value) {
  const parts = path.split(".");
  let target = catalog;
  for (const part of parts.slice(0, -1)) {
    const current = target[part];
    if (!current || typeof current !== "object" || Array.isArray(current)) target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}

function interpolationVariables(value) {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)].map((match) => match[1]).sort();
}

function protectedValues(value) {
  return [...value.matchAll(protectedValuePattern)].map((match) => match[0]).sort();
}

function protectText(value) {
  const replacements = [];
  const text = value.replace(protectedPattern, (match) => {
    const token = `{${replacements.length}}`;
    replacements.push([token, match]);
    return token;
  });
  return { text, replacements };
}

function restoreText(value, replacements) {
  let restored = value;
  for (const [token, original] of replacements) {
    if (!restored.includes(token)) throw new Error(`Translation changed protected token ${token}`);
    restored = restored.replaceAll(token, original);
  }
  return restored;
}

async function googleTranslate(text, targetLanguage) {
  const parameters = new URLSearchParams({
    client: "dict-chrome-ex",
    sl: "en",
    tl: googleLanguageAliases.get(targetLanguage) ?? targetLanguage,
    dt: "t",
    q: text,
  });
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const scheduledAt = Math.max(Date.now(), nextGoogleRequestAt);
      nextGoogleRequestAt = scheduledAt + 350;
      if (scheduledAt > Date.now()) {
        await new Promise((resolve) => setTimeout(resolve, scheduledAt - Date.now()));
      }
      const response = await fetch(`https://clients5.google.com/translate_a/t?${parameters}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const error = new Error(`Google Translate returned HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfterSeconds = Number(response.headers.get("retry-after")) || undefined;
        throw error;
      }
      const payload = await response.json();
      if (Array.isArray(payload) && payload.every((segment) => typeof segment === "string")) {
        return payload.join("");
      }
      throw new Error("Google Translate returned an unexpected response");
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        const retryAfterMs = Number(error?.retryAfterSeconds) * 1_000;
        const backoffMs = Number.isFinite(retryAfterMs)
          ? retryAfterMs
          : error?.status === 429
            ? Math.min(60_000, 15_000 * 2 ** attempt)
            : Math.min(30_000, 1_000 * 2 ** attempt);
        nextGoogleRequestAt = Math.max(nextGoogleRequestAt, Date.now() + backoffMs);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
}

async function translateEntries(entries, language) {
  if (entries.length === 0) return [];
  const protectedEntries = entries.map(({ value }) => protectText(value));
  const separators = protectedEntries.slice(1).map((_, index) => `{${9000 + index}}`);
  const joined = protectedEntries
    .flatMap(({ text }, index) => (index === 0 ? [text] : [separators[index - 1], text]))
    .join("\n");

  try {
    const translated = await googleTranslate(joined, language);
    const separatorPattern = /\s*\{9\d{3}\}\s*/g;
    const parts = translated.split(separatorPattern);
    if (parts.length !== entries.length) throw new Error("Translation changed batch separators");
    return parts.map((part, index) =>
      restoreText(part.trim(), protectedEntries[index].replacements)
    );
  } catch (error) {
    if (entries.length === 1) throw error;
    const midpoint = Math.ceil(entries.length / 2);
    return [
      ...(await translateEntries(entries.slice(0, midpoint), language)),
      ...(await translateEntries(entries.slice(midpoint), language)),
    ];
  }
}

async function generateCatalog(language, englishCatalog, sourceSnapshot) {
  const path = join(generatedDirectory, `${language}.json`);
  let catalog = {};
  try {
    catalog = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const englishEntries = [...flattenCatalog(englishCatalog)].map(([key, value]) => ({
    key,
    value,
  }));
  const existing = flattenCatalog(catalog);
  const pending = englishEntries.filter(({ key, value: englishValue }) => {
    const value = existing.get(key);
    return (
      typeof value !== "string" ||
      !value.trim() ||
      (sourceSnapshot && sourceSnapshot.get(key) !== englishValue) ||
      interpolationVariables(value).join("\0") !==
        interpolationVariables(englishValue).join("\0") ||
      protectedValues(value).join("\0") !== protectedValues(englishValue).join("\0")
    );
  });

  for (let index = 0; index < pending.length; index += 40) {
    const batch = pending.slice(index, index + 40);
    const translations = await translateEntries(batch, language);
    batch.forEach(({ key }, translationIndex) => {
      setCatalogValue(catalog, key, translations[translationIndex]);
    });
    await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`);
  }
  return pending.length;
}

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
}

function validateCatalog(language, englishCatalog, catalog) {
  const errors = [];
  const english = flattenCatalog(englishCatalog);
  const translated = flattenCatalog(catalog);
  for (const [key, englishValue] of english) {
    const translatedValue = translated.get(key);
    if (typeof translatedValue !== "string" || !translatedValue.trim()) {
      errors.push(`${language} is missing a nonempty string at ${key}`);
      continue;
    }
    if (
      interpolationVariables(englishValue).join("\0") !==
      interpolationVariables(translatedValue).join("\0")
    ) {
      errors.push(`${language} changes interpolation variables at ${key}`);
    }
    if (protectedValues(englishValue).join("\0") !== protectedValues(translatedValue).join("\0")) {
      errors.push(`${language} changes a protected URL or product name at ${key}`);
    }
  }
  for (const key of translated.keys()) {
    if (!english.has(key)) errors.push(`${language} has an extra key at ${key}`);
  }
  return errors;
}

function loaderSource() {
  const entries = registeredLanguages
    .filter((language) => language !== "en")
    .map((language) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(language) ? language : JSON.stringify(language);
      return language === "es"
        ? `  es: () => import("./locales/es").then(({ es }) => ({ default: es })),`
        : `  ${key}: () => import("./locales/generated/${language}.json"),`;
    })
    .join("\n");
  return `import type { DisplayLanguage } from "@shared/display-language";\n\nimport type { TranslationCatalog } from "./locales/en";\n\ntype LazyDisplayLanguage = Exclude<DisplayLanguage, "en">;\ntype CatalogModule = { default: TranslationCatalog };\n\nexport const DISPLAY_LANGUAGE_CATALOG_LOADERS: Record<\n  LazyDisplayLanguage,\n  () => Promise<CatalogModule>\n> = {\n${entries}\n};\n`;
}

const errors = [];
if (registeredLanguages.length !== 50) {
  errors.push(
    `Expected exactly 50 registered display languages, found ${registeredLanguages.length}`
  );
}
if (new Set(registeredLanguages).size !== registeredLanguages.length) {
  errors.push("Display language codes must be unique");
}

const englishCatalog = await sourceCatalog("en");
const spanishCatalog = await sourceCatalog("es");
errors.push(...validateCatalog("es", englishCatalog, spanishCatalog));

let sourceSnapshot;
try {
  sourceSnapshot = new Map(Object.entries(JSON.parse(await readFile(sourceSnapshotPath, "utf8"))));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const currentEnglishSnapshot = Object.fromEntries(flattenCatalog(englishCatalog));
if (
  !shouldGenerate &&
  JSON.stringify(Object.fromEntries(sourceSnapshot ?? [])) !==
    JSON.stringify(currentEnglishSnapshot)
) {
  errors.push("Generated catalogs are stale; run npm run generate:i18n-catalogs");
}

if (shouldGenerate) {
  await mkdir(generatedDirectory, { recursive: true });
  await writeFile(loaderPath, loaderSource());
  const generationErrors = [];
  await runWithConcurrency(generatedLanguages, 4, async (language) => {
    try {
      const generatedValues = await generateCatalog(language, englishCatalog, sourceSnapshot);
      process.stdout.write(
        generatedValues > 0
          ? `Generated ${language}: ${generatedValues} values.\n`
          : `Preserved ${language}: complete.\n`
      );
    } catch (error) {
      generationErrors.push(
        `${language}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
  if (generationErrors.length) throw new Error(generationErrors.join("\n"));
  await writeFile(sourceSnapshotPath, `${JSON.stringify(currentEnglishSnapshot, null, 2)}\n`);
}

let generatedFiles = [];
try {
  generatedFiles = (await readdir(generatedDirectory))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
for (const language of generatedLanguages) {
  if (!generatedFiles.includes(language)) {
    errors.push(`Missing generated catalog for ${language}`);
    continue;
  }
  const catalog = JSON.parse(await readFile(join(generatedDirectory, `${language}.json`), "utf8"));
  errors.push(...validateCatalog(language, englishCatalog, catalog));
}
for (const language of generatedFiles) {
  if (!generatedLanguages.includes(language))
    errors.push(`Unexpected generated catalog ${language}`);
}

let actualLoader = "";
try {
  actualLoader = await readFile(loaderPath, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (actualLoader !== loaderSource()) errors.push("Generated catalog loader is stale");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${registeredLanguages.length} complete display-language catalogs.`);
}

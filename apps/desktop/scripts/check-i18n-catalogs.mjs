import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const localeDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/frontend/i18n/locales"
);
const languageRegistryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/shared/display-language.ts"
);
const localeFiles = (await readdir(localeDirectory)).filter((file) => file.endsWith(".ts")).sort();
const registrySource = await readFile(languageRegistryPath, "utf8");
const registeredLanguages = [...registrySource.matchAll(/\bcode:\s*"([^"]+)"/g)].map(
  (match) => match[1]
);

function catalogKeys(source) {
  return [...source.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*:/g)].map((match) => match[1]).sort();
}

const catalogs = await Promise.all(
  localeFiles.map(async (file) => ({
    file,
    source: await readFile(join(localeDirectory, file), "utf8"),
  }))
);
const base = catalogs.find(({ file }) => file === "en.ts");
if (!base) throw new Error("The English base catalog is missing");
const translations = catalogs.filter(({ file }) => file !== base.file);
const baseKeys = catalogKeys(base.source);
const errors = catalogs.flatMap(({ file, source }) => {
  const empty = [...source.matchAll(/:\s*["']\s*["']/g)].map((match) => match.index);
  return empty.length ? [`${file} contains an empty translation at character ${empty[0]}`] : [];
});
const catalogLanguages = localeFiles.map((file) => file.replace(/\.ts$/, ""));
const missingCatalogs = registeredLanguages.filter(
  (language) => !catalogLanguages.includes(language)
);
const unregisteredCatalogs = catalogLanguages.filter(
  (language) => !registeredLanguages.includes(language)
);
if (missingCatalogs.length) errors.push(`Missing locale catalogs: ${missingCatalogs.join(", ")}`);
if (unregisteredCatalogs.length) {
  errors.push(`Unregistered locale catalogs: ${unregisteredCatalogs.join(", ")}`);
}

for (const translation of translations) {
  const keys = catalogKeys(translation.source);
  const missing = baseKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !baseKeys.includes(key));
  if (missing.length) errors.push(`${translation.file} is missing keys: ${missing.join(", ")}`);
  if (extra.length) errors.push(`${translation.file} has extra keys: ${extra.join(", ")}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}

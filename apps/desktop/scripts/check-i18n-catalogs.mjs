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
const registrySource = await readFile(languageRegistryPath, "utf8");
const registeredLanguages = [...registrySource.matchAll(/\bcode:\s*"([^"]+)"/g)].map(
  (match) => match[1]
);

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
  return empty.length ? [`${file} contains an empty translation at character ${empty[0]}`] : [];
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

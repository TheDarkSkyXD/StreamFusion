import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptsDirectory, "..");
const componentsDirectory = path.join(desktopDirectory, "src", "components");
const exclusionsPath = path.join(scriptsDirectory, "storybook-exclusions.json");

const STORY_SUFFIX = ".stories.tsx";
const COMPONENT_SUFFIX = ".tsx";
const MINIMUM_REASON_LENGTH = 30;

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function collectTsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectTsxFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith(COMPONENT_SUFFIX) ? [entryPath] : [];
    })
  );

  return nestedFiles.flat();
}

async function readExclusions() {
  const source = await readFile(exclusionsPath, "utf8");
  const manifest = JSON.parse(source);

  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.version !== 1 ||
    !manifest.exclusions ||
    typeof manifest.exclusions !== "object" ||
    Array.isArray(manifest.exclusions)
  ) {
    throw new Error(
      'storybook-exclusions.json must contain { "version": 1, "exclusions": { ... } }.'
    );
  }

  return manifest.exclusions;
}

function validateExclusions(exclusions, componentPaths, coveredPaths) {
  const errors = [];

  for (const [componentPath, reason] of Object.entries(exclusions)) {
    const normalizedPath = normalizeRelativePath(componentPath);

    if (componentPath !== normalizedPath || path.isAbsolute(componentPath)) {
      errors.push(`${componentPath}: use a normalized path relative to src/components.`);
      continue;
    }

    if (
      componentPath.startsWith("../") ||
      componentPath.includes("/../") ||
      !componentPath.endsWith(COMPONENT_SUFFIX) ||
      componentPath.endsWith(STORY_SUFFIX)
    ) {
      errors.push(`${componentPath}: is not a valid component path.`);
      continue;
    }

    if (!componentPaths.has(componentPath)) {
      errors.push(`${componentPath}: does not match a current component file.`);
      continue;
    }

    if (coveredPaths.has(componentPath)) {
      errors.push(`${componentPath}: has a story and no longer needs an exclusion.`);
    }

    if (
      typeof reason !== "string" ||
      reason.trim().length < MINIMUM_REASON_LENGTH ||
      /^(?:n\/a|none|nonvisual|support|provider|index|types?)\.?$/i.test(reason.trim())
    ) {
      errors.push(
        `${componentPath}: exclusion reason must concretely explain why the file has no visual story.`
      );
    }
  }

  return errors;
}

function toExpectedStoryPath(componentPath) {
  return `${componentPath.slice(0, -COMPONENT_SUFFIX.length)}${STORY_SUFFIX}`;
}

async function buildCoverageReport() {
  const [files, exclusions] = await Promise.all([
    collectTsxFiles(componentsDirectory),
    readExclusions(),
  ]);
  const relativeFiles = files.map((filePath) =>
    normalizeRelativePath(path.relative(componentsDirectory, filePath))
  );
  const componentPaths = new Set(
    relativeFiles.filter((filePath) => !filePath.endsWith(STORY_SUFFIX))
  );
  const storyPaths = relativeFiles.filter((filePath) => filePath.endsWith(STORY_SUFFIX));
  const coveredPaths = new Set(
    storyPaths
      .map((storyPath) => `${storyPath.slice(0, -STORY_SUFFIX.length)}${COMPONENT_SUFFIX}`)
      .filter((componentPath) => componentPaths.has(componentPath))
  );
  const orphanStories = storyPaths
    .filter((storyPath) => {
      const componentPath = `${storyPath.slice(0, -STORY_SUFFIX.length)}${COMPONENT_SUFFIX}`;
      return !componentPaths.has(componentPath);
    })
    .sort();
  const excludedPaths = new Set(Object.keys(exclusions));
  const missingComponents = [...componentPaths]
    .filter(
      (componentPath) => !coveredPaths.has(componentPath) && !excludedPaths.has(componentPath)
    )
    .sort();
  const exclusionErrors = validateExclusions(exclusions, componentPaths, coveredPaths);

  return {
    componentCount: componentPaths.size,
    storyCount: storyPaths.length,
    coveredCount: coveredPaths.size,
    excludedCount: excludedPaths.size,
    missingCount: missingComponents.length,
    orphanStoryCount: orphanStories.length,
    missingComponents,
    orphanStories,
    exclusionErrors,
    passed:
      missingComponents.length === 0 && orphanStories.length === 0 && exclusionErrors.length === 0,
  };
}

function printHumanReport(report) {
  console.log("Storybook component coverage");
  console.log(`  Component files:    ${report.componentCount}`);
  console.log(`  Story files:        ${report.storyCount}`);
  console.log(`  Covered components: ${report.coveredCount}`);
  console.log(`  Explicit exclusions: ${report.excludedCount}`);
  console.log(`  Missing stories:    ${report.missingCount}`);
  console.log(`  Orphan stories:     ${report.orphanStoryCount}`);

  if (report.missingComponents.length > 0) {
    console.error("\nMissing collocated stories:");
    for (const componentPath of report.missingComponents) {
      console.error(`  - ${componentPath} -> ${toExpectedStoryPath(componentPath)}`);
    }
  }

  if (report.orphanStories.length > 0) {
    console.error("\nStories without a same-basename component:");
    for (const storyPath of report.orphanStories) {
      console.error(`  - ${storyPath}`);
    }
  }

  if (report.exclusionErrors.length > 0) {
    console.error("\nInvalid exclusions:");
    for (const error of report.exclusionErrors) {
      console.error(`  - ${error}`);
    }
  }

  if (report.passed) {
    console.log("\nStorybook coverage check passed.");
  } else {
    console.error(
      "\nStorybook coverage check failed. Add each story or document a genuine nonvisual exclusion."
    );
  }
}

try {
  const report = await buildCoverageReport();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  if (!report.passed) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Storybook coverage check could not run: ${message}`);
  process.exitCode = 1;
}

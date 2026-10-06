import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [specPath, outputDirectory] = process.argv.slice(2);
if (!specPath || !outputDirectory) {
  throw new Error(
    "Usage: node scripts/compare-ui-screenshots.mjs pairs.json output-directory",
  );
}
const pairs = JSON.parse(await readFile(specPath, "utf8"));
if (!Array.isArray(pairs) || pairs.length === 0) {
  throw new Error(
    "The comparison specification must contain screenshot pairs.",
  );
}
await mkdir(outputDirectory, { recursive: true });
const reports = [];
for (const pair of pairs) {
  if (typeof pair.id !== "string" || !/^[a-z0-9-]+$/u.test(pair.id)) {
    throw new Error("Each comparison needs a safe id.");
  }
  const load = async (file, crop) => {
    const source = sharp(path.resolve(path.dirname(specPath), file));
    if (crop) source.extract(crop);
    return source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  const [baseline, actual] = await Promise.all([
    load(pair.baseline, pair.baselineCrop),
    load(pair.actual, pair.actualCrop),
  ]);
  const { width, height, channels } = baseline.info;
  if (
    actual.info.width !== width ||
    actual.info.height !== height ||
    channels !== 4
  ) {
    throw new Error(
      `${pair.id}: screenshot dimensions differ. Capture at matching sizes without resizing.`,
    );
  }
  const masks = pair.masks ?? [];
  for (const mask of masks) {
    if (
      !mask.reason ||
      ![mask.left, mask.top, mask.width, mask.height].every(Number.isInteger) ||
      mask.left < 0 ||
      mask.top < 0 ||
      mask.width <= 0 ||
      mask.height <= 0 ||
      mask.left + mask.width > width ||
      mask.top + mask.height > height
    ) {
      throw new Error(
        `${pair.id}: masks need an explanation and valid bounds.`,
      );
    }
  }
  const diff = Buffer.alloc(width * height * 4);
  let comparedPixels = 0;
  let changedPixels = 0;
  let absoluteChannelDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      diff[offset + 3] = 255;
      if (
        masks.some(
          (mask) =>
            x >= mask.left &&
            x < mask.left + mask.width &&
            y >= mask.top &&
            y < mask.top + mask.height,
        )
      ) {
        diff[offset + 2] = 96;
        continue;
      }
      comparedPixels += 1;
      let changed = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(
          baseline.data[offset + channel] - actual.data[offset + channel],
        );
        absoluteChannelDelta += delta;
        changed ||= delta !== 0;
      }
      if (changed) {
        changedPixels += 1;
        diff[offset] = 255;
        diff[offset + 2] = 96;
      } else {
        const grey = Math.round(
          (actual.data[offset] +
            actual.data[offset + 1] +
            actual.data[offset + 2]) /
            12,
        );
        diff[offset] = grey;
        diff[offset + 1] = grey;
        diff[offset + 2] = grey;
      }
    }
  }
  await sharp(diff, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(path.join(outputDirectory, `${pair.id}-diff.png`));
  reports.push({
    ...pair,
    width,
    height,
    comparedPixels,
    changedPixels,
    absoluteChannelDelta,
    verdict: changedPixels === 0 ? "identical" : "differences",
  });
}
await writeFile(
  path.join(outputDirectory, "results.json"),
  `${JSON.stringify(reports, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    reports.map(({ id, changedPixels, comparedPixels, verdict }) => ({
      id,
      changedPixels,
      comparedPixels,
      verdict,
    })),
    null,
    2,
  ),
);

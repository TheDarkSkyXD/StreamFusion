const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

function trimRoot(target) {
  return path.win32.normalize(target).replace(/[\\/]+$/, "");
}

function translateResolvedPath(resolvedPath, targetRoot, driveRoot) {
  const wasBuffer = Buffer.isBuffer(resolvedPath);
  const resolvedText = wasBuffer ? resolvedPath.toString() : resolvedPath;
  const normalizedTarget = trimRoot(targetRoot);
  const normalizedDrive = trimRoot(driveRoot);
  const relative = path.win32.relative(normalizedTarget, resolvedText);

  if (relative.startsWith("..") || path.win32.isAbsolute(relative)) {
    return resolvedPath;
  }

  const translated = path.win32.join(normalizedDrive, relative);
  return wasBuffer ? Buffer.from(translated) : translated;
}

function patchRealpath(targetRoot, driveRoot) {
  const translate = (resolvedPath) =>
    translateResolvedPath(resolvedPath, targetRoot, driveRoot);
  const wrapCallback = (original) =>
    function wrappedRealpath(target, ...arguments_) {
      const callback = arguments_.pop();
      return original.call(fs, target, ...arguments_, (error, resolvedPath) => {
        callback(error, error ? resolvedPath : translate(resolvedPath));
      });
    };

  const originalRealpath = fs.realpath;
  const wrappedRealpath = wrapCallback(originalRealpath);
  wrappedRealpath.native = wrapCallback(originalRealpath.native);
  fs.realpath = wrappedRealpath;

  const originalRealpathSync = fs.realpathSync;
  const wrappedRealpathSync = (...arguments_) =>
    translate(originalRealpathSync(...arguments_));
  wrappedRealpathSync.native = (...arguments_) =>
    translate(originalRealpathSync.native(...arguments_));
  fs.realpathSync = wrappedRealpathSync;

  for (const promises of new Set([fs.promises, fsPromises])) {
    const originalPromiseRealpath = promises.realpath.bind(promises);
    promises.realpath = async (...arguments_) =>
      translate(await originalPromiseRealpath(...arguments_));
  }
}

const targetRoot = process.env.STREAMFUSION_SUBST_TARGET_ROOT;
const driveRoot = process.env.STREAMFUSION_SUBST_DRIVE_ROOT;

if (targetRoot && driveRoot) {
  patchRealpath(targetRoot, driveRoot);
}

module.exports = { translateResolvedPath };

import lockfile from "eslint-plugin-lockfile";

const recommended = Array.isArray(lockfile.configs.recommended)
  ? lockfile.configs.recommended
  : [lockfile.configs.recommended];

export default [
  {
    plugins: { lockfile },
  },
  ...recommended,
  {
    files: ["package.json", "apps/*/package.json"],
    rules: {
      "lockfile/tracked": "off",
    },
  },
  {
    files: ["pnpm-lock.yaml", "apps/*/pnpm-lock.yaml"],
    rules: {
      "lockfile/binary-conflicts": "off",
      "lockfile/flavor": ["error", "pnpm"],
      "lockfile/integrity": "error",
      "lockfile/minimum-release-age": "off",
      "lockfile/non-registry-specifiers": "error",
      "lockfile/registry": ["error", "https://registry.npmjs.org"],
      "lockfile/version": ["error", { pnpm: "9.0" }],
    },
  },
];

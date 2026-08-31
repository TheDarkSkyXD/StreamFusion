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
    files: ["package-lock.json"],
    rules: {
      "lockfile/flavor": ["error", "npm"],
      "lockfile/integrity": "error",
      "lockfile/minimum-release-age": "off",
      "lockfile/name-matches-resolved": "off",
      "lockfile/non-registry-specifiers": "error",
      "lockfile/registry": ["error", "https://registry.npmjs.org"],
      "lockfile/version": ["error", { npm: 3 }],
    },
  },
];

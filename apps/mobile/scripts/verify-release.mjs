import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const mobileRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(mobileRoot, "..", "..");
const certificatePath = path.join(
  mobileRoot,
  "config",
  "production-signing-certificate.json",
);
const certifierPath = path.join(
  mobileRoot,
  "config",
  "production-signing-certificate.schema.json",
);
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const PIN_MODE = "--pin";

export function readPinnedCertificate() {
  if (!existsSync(certificatePath)) {
    throw new Error(
      `Missing ${path.relative(repositoryRoot, certificatePath)}. A release cannot be verified without a pinned signing certificate.`,
    );
  }
  const pinned = JSON.parse(readFileSync(certificatePath, "utf8"));
  const schema = JSON.parse(readFileSync(certifierPath, "utf8"));

  if (pinned.applicationId !== schema.properties.applicationId.const) {
    throw new Error(
      `Pinned certificate is for ${pinned.applicationId}, not ${schema.properties.applicationId.const}.`,
    );
  }
  if (pinned.certificateSha256 === null) {
    throw new Error(
      "No production signing certificate is pinned, so no production Android release is authorized. Generate the StreamFusion Mobile production key, then run npm run verify:release -- --pin <sha256>.",
    );
  }
  if (!FINGERPRINT_PATTERN.test(pinned.certificateSha256)) {
    throw new Error(
      `Pinned certificateSha256 is not 64 lowercase hex characters: ${pinned.certificateSha256}`,
    );
  }
  if (!pinned.recordedBy || !pinned.recordedAt) {
    throw new Error(
      "Pinned certificate is missing recordedBy and recordedAt. A fingerprint without provenance cannot be audited later.",
    );
  }
  return pinned;
}

function pinFingerprint(fingerprint, recordedBy) {
  if (!fingerprint) {
    throw new Error(
      `Usage: node scripts/verify-release.mjs ${PIN_MODE} <sha256> [recorded-by]`,
    );
  }
  const normalized = fingerprint.replaceAll(":", "").toLowerCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new Error(
      `Not a SHA-256 certificate fingerprint: ${fingerprint}. Read it from "keytool -list -v -keystore <keystore> -alias <alias>" or "eas credentials".`,
    );
  }
  if (!recordedBy) {
    throw new Error(
      "recordedBy is required. Name the person or runbook that produced the key so a later reader knows who to ask about the offline backups.",
    );
  }
  const pinned = JSON.parse(readFileSync(certificatePath, "utf8"));
  const previous = pinned.certificateSha256;
  if (previous && previous !== normalized) {
    throw new Error(
      `Refusing to replace pinned certificate ${previous} with ${normalized}. Android accepts an update only when the signing certificate matches, so a new signer strands every existing installation. Publish a new application id instead, or prove a v3 proof-of-rotation lineage first.`,
    );
  }
  writeFileSync(
    certificatePath,
    `${JSON.stringify(
      {
        ...pinned,
        certificateSha256: normalized,
        recordedBy,
        recordedAt: new Date().toISOString().slice(0, 10),
      },
      null,
      2,
    )}\n`,
  );
  return normalized;
}

function resolveAapt2() {
  const explicit = process.env.AAPT2_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (androidHome) {
    const buildTools = path.join(androidHome, "build-tools");
    if (existsSync(buildTools)) {
      const versions = readdirSync(buildTools)
        .filter((entry) => /^\d+/u.test(entry))
        .sort(compareNumericVersions)
        .reverse();
      for (const version of versions) {
        for (const name of process.platform === "win32" ? ["aapt2.exe"] : ["aapt2"]) {
          const candidate = path.join(buildTools, version, name);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  return null;
}

function compareNumericVersions(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

function readPackageName(apkPath) {
  const aapt2 = resolveAapt2();
  if (!aapt2) return null;

  const result = spawnSync(aapt2, ["dump", "badging", apkPath], {
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.match(/package:\s*name='([^']+)'/u)?.[1] ?? null;
}

export function verifyApk(apkPath) {
  const pinned = readPinnedCertificate();
  if (!apkPath) {
    return { ...pinned, verifiedApk: null };
  }
  if (!existsSync(apkPath)) {
    throw new Error(`APK not found: ${apkPath}`);
  }

  const apksigner = process.env.APKSIGNER_PATH;
  if (!apksigner) {
    throw new Error(
      "APKSIGNER_PATH must point at the Android SDK build-tools apksigner to verify an APK. Point it at $ANDROID_HOME/build-tools/<version>/apksigner.",
    );
  }

  // apksigner ships as a shell script, not a binary, and verify writes its
  // report to stdout while a non-zero status is possible even for a good APK.
  // Both the output streams and the status are read so a warning never turns
  // into a missing report.
  const result = spawnSync(apksigner, ["verify", "--verbose", "--print-certs", apkPath], {
    encoding: "utf8",
    shell: true,
  });
  if (result.error) throw result.error;
  const report = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  // apksigner output varies by build-tools version: the digest may be colon
  // separated uppercase or bare lowercase hex, and the label is "Signer #1" for
  // a v3 signature but "V2 Signer:" for a v2-only one, which is what Gradle
  // produces. Match any of those and require 64 hex characters, which is long
  // enough that a SHA-1 or MD5 line can never satisfy it.
  const signerFingerprint = report.match(
    /(?:Signer #1|V2 Signer):?\s*certificate SHA-256 digest:\s*([0-9a-fA-F]{2}(?::?[0-9a-fA-F]{2}){31})/u,
  )?.[1];
  if (!signerFingerprint) {
    throw new Error(
      `apksigner did not report a signer SHA-256 digest for ${apkPath}. An APK with no readable signer cannot be published. apksigner said: ${report.trim() || "nothing"}`,
    );
  }
  const normalized = signerFingerprint.replaceAll(":", "").toLowerCase();
  if (normalized !== pinned.certificateSha256) {
    throw new Error(
      `${apkPath} is signed by ${normalized}, not the pinned ${pinned.certificateSha256}. Refusing to treat an unexpected signer as a release.`,
    );
  }

  // apksigner does not report the application id, so the package name is read
  // from the manifest through aapt2. A missing value is a failure rather than a
  // pass: the certificate alone does not prove the public application id, and a
  // development-identity APK signed with the production key is a different app
  // that users can never upgrade to the public one.
  const packageName = readPackageName(apkPath);
  if (!packageName) {
    throw new Error(
      `Could not read the application id from ${apkPath}. Set AAPT2_PATH to the Android SDK build-tools aapt2 so the release check can prove this is ${pinned.applicationId}.`,
    );
  }
  if (packageName !== pinned.applicationId) {
    throw new Error(
      `${apkPath} declares application id ${packageName}, not ${pinned.applicationId}. A release must carry the public application id.`,
    );
  }
  return { ...pinned, verifiedApk: { path: apkPath, packageName } };
}

function main(argv) {
  if (argv[0] === PIN_MODE) {
    const fingerprint = pinFingerprint(argv[1], argv[2]);
    console.log(
      `Pinned production signing certificate ${fingerprint} for ${readPinnedCertificate().applicationId}. Record the same fingerprint in the Android Developer Console package registration.`,
    );
    return;
  }
  const result = verifyApk(argv.find((argument) => argument.endsWith(".apk")));
  console.log(
    result.verifiedApk
      ? `Verified ${result.verifiedApk.path} against pinned signer ${result.certificateSha256}.`
      : `Pinned signer ${result.certificateSha256} for ${result.applicationId}. Pass an APK path to verify an artifact against it.`,
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

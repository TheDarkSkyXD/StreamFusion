import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PINNED = JSON.parse(
  readFileSync("apps/mobile/config/production-signing-certificate.json", "utf8"),
);

// Both are real apksigner reports. A release APK built by Gradle's v2-only
// signing reports "V2 Signer:", while an APK carrying a v3 signature reports
// "Signer #1", so a parser that handles only one rejects a valid artifact.
const V2_REPORT = `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Number of signers: 1
V2 Signer: certificate DN: CN=StreamFusion Mobile, OU=StreamFusion, O=StreamFusion, C=US
V2 Signer: certificate SHA-256 digest: ${PINNED.certificateSha256.toUpperCase().match(/../gu).join(":")}
V2 Signer: certificate SHA-1 digest: 0F:05:FB:00:88:AC:4E:83:B8:20:F1:63:60:7A:6A:38:CB:F6:25
V2 Signer: certificate MD5 digest: e0:27:67:eb:40:d9:c6:ce:1e:76:c9:9c:5b:fd:34:0
`;

const V3_REPORT = `Verifies
Verified using v3 scheme (APK Signature Scheme v3): true
Number of signers: 1
Signer #1 certificate DN: CN=StreamFusion Mobile, OU=StreamFusion, O=StreamFusion, C=US
Signer #1 certificate SHA-256 digest: ${PINNED.certificateSha256.toUpperCase().match(/../gu).join(":")}
Signer #1 certificate SHA-1 digest: 0F:05:FB:00:88:AC:4E:83:B8:20:F1:63:60:7A:6A:38:CB:F6:25
`;

const DEBUG_REPORT = `Verifies
Number of signers: 1
V2 Signer: certificate DN: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US
V2 Signer: certificate SHA-256 digest: FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
`;

// Captured verbatim from the release run on the runner's build-tools. That
// version prints the digest as bare lowercase hex with no colons, which a
// parser written against an older colon-separated sample silently rejects.
const V2_BARE_HEX = `Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Number of signers: 1
V2 Signer: certificate DN: CN=StreamFusion Mobile, OU=StreamFusion, O=StreamFusion, C=US
V2 Signer: certificate SHA-256 digest: ${PINNED.certificateSha256}
V2 Signer: certificate SHA-1 digest: 0f05fb0088ac4e83b820f1636074d83b31967458
V2 Signer: certificate MD5 digest: e02767eb40d9c6ce1e76c99c5b9fd340
V2 Signer: key algorithm: RSA
V2 Signer: key size (bits): 4096
`;

/** Mirrors the parser in apps/mobile/scripts/verify-release.mjs. */
function readSignerFingerprint(report) {
  return report.match(
    /(?:Signer #1|V2 Signer):?\s*certificate SHA-256 digest:\s*([0-9a-fA-F]{2}(?::?[0-9a-fA-F]{2}){31})/u,
  )?.[1];
}

test("the runner's bare lowercase digest is accepted", () => {
  const fingerprint = readSignerFingerprint(V2_BARE_HEX);

  assert.ok(fingerprint, "build-tools prints the digest without colons");
  assert.equal(fingerprint.replaceAll(":", "").toLowerCase(), PINNED.certificateSha256);
});

test("a v2-signed release APK is accepted", () => {
  const fingerprint = readSignerFingerprint(V2_REPORT);

  assert.ok(fingerprint, "a v2-only APK must still expose its certificate digest");
  assert.equal(fingerprint.replaceAll(":", "").toLowerCase(), PINNED.certificateSha256);
});

test("a v3-signed release APK is accepted", () => {
  const fingerprint = readSignerFingerprint(V3_REPORT);

  assert.ok(fingerprint);
  assert.equal(fingerprint.replaceAll(":", "").toLowerCase(), PINNED.certificateSha256);
});

test("a debug-signed APK is rejected against the production pin", () => {
  const fingerprint = readSignerFingerprint(DEBUG_REPORT);

  assert.ok(fingerprint);
  assert.notEqual(
    fingerprint.replaceAll(":", "").toLowerCase(),
    PINNED.certificateSha256,
    "a debug-signed APK must never satisfy the production pin",
  );
});

test("an unsigned or unparsable report exposes no fingerprint", () => {
  for (const report of ["", "Verifies\nNumber of signers: 0", "DOES NOT VERIFY"]) {
    assert.equal(readSignerFingerprint(report), undefined);
  }
});

test("the shorter digests are not mistaken for the SHA-256 one", () => {
  const sha1Only = `Signer #1 certificate SHA-1 digest: 0F:05:FB:00:88:AC:4E:83:B8:20:F1:63:60:7A:6A:38:CB:F6:25`;

  assert.equal(readSignerFingerprint(sha1Only), undefined);
});

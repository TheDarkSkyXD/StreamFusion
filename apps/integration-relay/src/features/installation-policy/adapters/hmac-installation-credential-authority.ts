import type {
  InstallationCredentialAuthority,
  InstallationCredentialClaim
} from "../capabilities/installation-registry";

const CREDENTIAL_VERSION = "v1";

export function createHmacInstallationCredentialAuthority(input: {
  readonly secret: string;
}): InstallationCredentialAuthority {
  const key = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"]
  );

  return {
    async issue(claim) {
      const encodedClaim = encodeBase64Url(
        new TextEncoder().encode(
          JSON.stringify({
            environment: claim.environment,
            expiresAtEpochMs: claim.expiresAtEpochMs,
            generation: claim.generation,
            installationId: claim.installationId
          })
        )
      );
      const message = new TextEncoder().encode(
        `${CREDENTIAL_VERSION}.${encodedClaim}`
      );
      const signature = await crypto.subtle.sign("HMAC", await key, message);
      return `${CREDENTIAL_VERSION}.${encodedClaim}.${encodeBase64Url(new Uint8Array(signature))}`;
    },

    async verify({ credential }) {
      const parts = credential.split(".");
      if (parts.length !== 3 || parts[0] !== CREDENTIAL_VERSION) return null;
      const [version, encodedClaim, encodedSignature] = parts;
      if (
        version === undefined ||
        encodedClaim === undefined ||
        encodedSignature === undefined
      )
        return null;
      const signature = decodeBase64Url(encodedSignature);
      const claimBytes = decodeBase64Url(encodedClaim);
      if (signature === null || claimBytes === null) return null;
      const message = new TextEncoder().encode(`${version}.${encodedClaim}`);
      if (
        !(await crypto.subtle.verify(
          "HMAC",
          await key,
          toArrayBuffer(signature),
          message
        ))
      )
        return null;
      return parseClaim(new TextDecoder().decode(claimBytes));
    }
  };
}

function parseClaim(value: string): InstallationCredentialClaim | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const record = parsed as Record<string, unknown>;
    if (
      Object.keys(record).length !== 4 ||
      (record.environment !== "development" &&
        record.environment !== "production") ||
      typeof record.expiresAtEpochMs !== "number" ||
      !Number.isSafeInteger(record.expiresAtEpochMs) ||
      typeof record.generation !== "number" ||
      !Number.isSafeInteger(record.generation) ||
      record.generation <= 0 ||
      typeof record.installationId !== "string" ||
      record.installationId.length === 0 ||
      record.installationId.length > 128
    ) {
      return null;
    }
    return {
      environment: record.environment,
      expiresAtEpochMs: record.expiresAtEpochMs,
      generation: record.generation,
      installationId: record.installationId
    };
  } catch {
    return null;
  }
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength
  ) as ArrayBuffer;
}

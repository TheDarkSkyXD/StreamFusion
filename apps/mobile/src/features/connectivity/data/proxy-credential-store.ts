import type { SecureSecretStore } from "@mobile/features/storage/capabilities/persistence";

const PROXY_CREDENTIAL_KEY = "proxy.credentials.v1";

export function createProxyCredentialStore(input: {
  readonly secrets: SecureSecretStore;
}): {
  read(): Promise<{ readonly username: string; readonly password: string } | null>;
  write(
    value: { readonly username: string; readonly password: string } | null,
  ): Promise<void>;
} {
  return {
    async read() {
      const raw = await input.secrets.get(PROXY_CREDENTIAL_KEY);
      if (raw === null || raw === "") return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("username" in parsed) ||
          !("password" in parsed) ||
          typeof parsed.username !== "string" ||
          typeof parsed.password !== "string"
        ) {
          return null;
        }
        return { password: parsed.password, username: parsed.username };
      } catch {
        return null;
      }
    },
    async write(value) {
      if (value === null || (value.username === "" && value.password === "")) {
        await input.secrets.delete(PROXY_CREDENTIAL_KEY);
        return;
      }
      await input.secrets.set(PROXY_CREDENTIAL_KEY, JSON.stringify(value));
    },
  };
}

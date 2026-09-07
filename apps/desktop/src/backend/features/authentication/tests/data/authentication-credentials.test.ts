import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthToken, TwitchUser } from "@shared/auth-types";
import { createOAuth2Session } from "@streamfusion/core/auth";

const boundary = vi.hoisted(() => ({
  available: true,
  failEncryption: false,
  failPersistence: false,
  data: new Map<string, unknown>(),
  set: vi.fn((key: string, value: unknown) => {
    if (boundary.failPersistence) throw new Error("Synthetic disk failure");
    boundary.data.set(key, value);
  }),
}));
vi.mock("electron", () => ({
  safeStorage: {
    encryptString: (value: string) => {
      if (boundary.failEncryption) throw new Error("Synthetic encryption failure");
      return Buffer.from(`secure:${value}`);
    },
    decryptString: (value: Buffer) => {
      const text = value.toString();
      if (!text.startsWith("secure:")) throw new Error("Not secure ciphertext");
      return text.slice(7);
    },
  },
}));
vi.mock("@backend/services/storage-service", () => ({
  storageService: {
    get encryptionAvailable() {
      return boundary.available;
    },
    getStore: () => ({ get: (key: string) => boundary.data.get(key), set: boundary.set }),
  },
}));
vi.mock("@backend/services/database-service", () => ({ dbService: {} }));
vi.mock("../../data/follow-repository", () => ({ followRepository: {} }));

import { AuthenticationRepository } from "../../data/authentication-repository";

const original: AuthToken = {
  accessToken: "synthetic-original",
  refreshToken: "synthetic-refresh",
};
const replacement: AuthToken = { accessToken: "synthetic-replacement" };
const bearer = "Bearer 123|SyntheticBearer";
const user: TwitchUser = {
  id: "100",
  login: "synthetic",
  displayName: "Synthetic",
  profileImageUrl: "",
  createdAt: "2026-01-01",
  broadcasterType: "",
};
const legacy = (value: string) => ({
  encrypted: Buffer.from(value).toString("base64"),
  encoding: "base64",
});

beforeEach(() => {
  boundary.available = true;
  boundary.failEncryption = false;
  boundary.failPersistence = false;
  boundary.data.clear();
  boundary.set.mockClear();
});

describe("Authentication credential persistence", () => {
  it("treats a failed secure refresh write as recoverable without clearing the signed-in account", async () => {
    const repository = new AuthenticationRepository();
    repository.saveToken("twitch", original);
    repository.saveTwitchUser(user);
    boundary.failEncryption = true;
    const clear = vi.fn();
    const lost = vi.fn();
    const session = createOAuth2Session<AuthToken>({
      credentials: {
        load: async () => repository.getToken("twitch"),
        save: async (token) => repository.saveToken("twitch", token),
        clear,
      },
      refresher: { refresh: async () => ({ kind: "refreshed", credential: replacement }) },
    });
    const unsubscribe = session.onAuthLost(lost);
    await expect(session.refresh()).resolves.toMatchObject({ kind: "transient-failure" });
    await expect(session.read()).resolves.toEqual({ kind: "connected", credential: original });
    expect(repository.getTwitchUser()).toEqual(user);
    expect(clear).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
    unsubscribe();
  });
  it("encrypts all credential families and reads them in a new repository instance", () => {
    const repository = new AuthenticationRepository();
    repository.saveToken("twitch", original);
    repository.saveTwitchFollowWriteToken(original);
    repository.saveKickWebBearer(bearer);
    expect(boundary.data.get("authTokens")).toMatchObject({ twitch: { encoding: "safeStorage" } });
    expect(boundary.data.get("twitchFollowWriteToken")).toMatchObject({ encoding: "safeStorage" });
    expect(boundary.data.get("kickWebBearer")).toMatchObject({ encoding: "safeStorage" });
    const restored = new AuthenticationRepository();
    expect(restored.getToken("twitch")).toEqual(original);
    expect(restored.getTwitchFollowWriteToken()).toEqual(original);
    expect(restored.getKickWebBearer()).toBe(bearer);
  });

  it.each(["unavailable", "encryption-failure"])(
    "refuses new writes without persisting plaintext on %s",
    (failure) => {
      boundary.available = failure !== "unavailable";
      boundary.failEncryption = failure === "encryption-failure";
      const repository = new AuthenticationRepository();
      for (const write of [
        () => repository.saveToken("twitch", original),
        () => repository.saveTwitchFollowWriteToken(original),
        () => repository.saveKickWebBearer(bearer),
      ])
        expect(write).toThrow(/Secure credential storage .*Credentials were not saved/);
      expect(boundary.set).not.toHaveBeenCalled();
      expect(boundary.data.size).toBe(0);
    }
  );

  it.each(["unavailable", "encryption-failure", "persistence-failure"])(
    "preserves the existing account, stored credentials, and cache on %s",
    (failure) => {
      const repository = new AuthenticationRepository();
      repository.saveToken("twitch", original);
      repository.saveTwitchUser(user);
      const previous = boundary.data.get("authTokens");
      const previousSnapshot = structuredClone(previous);
      boundary.available = failure !== "unavailable";
      boundary.failEncryption = failure === "encryption-failure";
      boundary.failPersistence = failure === "persistence-failure";
      expect(() => repository.saveToken("twitch", replacement)).toThrow();
      expect(repository.getToken("twitch")).toEqual(original);
      expect(repository.getTwitchUser()).toEqual(user);
      expect(previous).toEqual(previousSnapshot);
      expect(boundary.data.get("authTokens")).toBe(previous);
      boundary.available = true;
      boundary.failEncryption = false;
      boundary.failPersistence = false;
      expect(new AuthenticationRepository().getToken("twitch")).toEqual(original);
    }
  );

  it.each(["unavailable", "encryption-failure", "persistence-failure"])(
    "keeps valid legacy reads and accounts when upgrade encounters %s",
    (failure) => {
      boundary.data.set("authTokens", { twitch: legacy(JSON.stringify(original)) });
      boundary.data.set("twitchFollowWriteToken", {
        encrypted: legacy(JSON.stringify(original)).encrypted,
      });
      boundary.data.set("kickWebBearer", legacy(bearer));
      boundary.data.set("twitchUser", user);
      const previous = structuredClone([...boundary.data]);
      boundary.available = failure !== "unavailable";
      boundary.failEncryption = failure === "encryption-failure";
      boundary.failPersistence = failure === "persistence-failure";
      const repository = new AuthenticationRepository();
      expect(repository.getToken("twitch")).toEqual(original);
      expect(repository.getTwitchFollowWriteToken()).toEqual(original);
      expect(repository.getKickWebBearer()).toBe(bearer);
      expect(repository.getTwitchUser()).toEqual(user);
      expect([...boundary.data]).toEqual(previous);
      boundary.available = true;
      boundary.failEncryption = false;
      boundary.failPersistence = false;
      const restarted = new AuthenticationRepository();
      expect(restarted.getToken("twitch")).toEqual(original);
      expect(restarted.getTwitchFollowWriteToken()).toEqual(original);
      expect(restarted.getKickWebBearer()).toBe(bearer);
      expect(boundary.data.get("authTokens")).toMatchObject({
        twitch: { encoding: "safeStorage" },
      });
      expect(boundary.data.get("twitchFollowWriteToken")).toMatchObject({
        encoding: "safeStorage",
      });
      expect(boundary.data.get("kickWebBearer")).toMatchObject({ encoding: "safeStorage" });
    }
  );

  it("does not decode a marked secure record as base64 when decryption fails", () => {
    boundary.data.set("authTokens", {
      twitch: { ...legacy(JSON.stringify(original)), encoding: "safeStorage" },
    });
    const previous = boundary.data.get("authTokens");
    expect(new AuthenticationRepository().getToken("twitch")).toBeNull();
    expect(boundary.data.get("authTokens")).toBe(previous);
    expect(boundary.set).not.toHaveBeenCalled();
  });
});

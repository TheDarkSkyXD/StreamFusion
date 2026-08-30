import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@shared/ipc-channels";

const electronMocks = vi.hoisted(() => ({
  app: { isPackaged: false },
  handle: vi.fn(),
}));

const readerMocks = vi.hoisted(() => ({
  getTwitchPublicIdentity: vi.fn(),
  getTwitchAccountCreated: vi.fn(),
  getTwitchFollowRelationship: vi.fn(),
  resolveTwitchPublicChannel: vi.fn(),
  getKickPublicIdentity: vi.fn(),
  getKickAccountCreated: vi.fn(),
  getKickFollowRelationship: vi.fn(),
  resolveKickPublicChannel: vi.fn(),
}));

vi.mock("electron", () => ({
  app: electronMocks.app,
  ipcMain: { handle: electronMocks.handle },
}));

vi.mock("@backend/api/platforms/twitch/twitch-public-profile-reader", () => readerMocks);
vi.mock("@backend/api/platforms/kick/kick-public-profile-reader", () => readerMocks);

import { registerUserProfileHandlers } from "@backend/ipc/handlers/user-profile-handlers";
import { TrustedIpcRegistry } from "@backend/ipc/trusted-ipc-registry";

type Handler = (event: unknown, request: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const call = electronMocks.handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as Handler;
}

const trustedMainFrame = { url: "http://localhost:5173/?userProfileFixture=loaded" };
const trustedSender = { mainFrame: trustedMainFrame };
const loadedFixtureEvent = { sender: trustedSender, senderFrame: trustedMainFrame };
const trustedDocumentUrl = "http://localhost:5173/";

beforeEach(() => {
  vi.clearAllMocks();
  electronMocks.app.isPackaged = false;
  trustedMainFrame.url = "http://localhost:5173/?userProfileFixture=loaded";
  registerUserProfileHandlers(
    new TrustedIpcRegistry({ trustedSender: () => trustedSender as never }, trustedDocumentUrl)
  );
});

// Guards: normal Electron development profile reads pass through typed IPC to the real readers.
// Guards: packaged builds ignore fixture query parameters and call the real profile readers.
// Guards: user-profile fixture routing does not intercept unrelated IPC methods.
// Guards: user-profile IPC rejects untrusted callers and malformed boundary values safely.
describe("user-profile IPC fixture routing", () => {
  it("treats the removed loaded fixture mode as a real-reader pass-through", async () => {
    const identity = {
      state: "known",
      source: "first-party-fallback",
      value: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: "",
      },
    };
    const accountCreated = {
      state: "known",
      source: "first-party-fallback",
      value: "2011-06-06T00:00:00Z",
    };
    const follow = {
      state: "known",
      source: "official",
      value: "2020-01-15T00:00:00Z",
    };
    const channel = {
      state: "known",
      source: "first-party-fallback",
      value: {
        id: "real-channel",
        username: "alice",
        displayName: "Alice",
      },
    };
    readerMocks.getTwitchPublicIdentity.mockResolvedValue(identity);
    readerMocks.getTwitchAccountCreated.mockResolvedValue(accountCreated);
    readerMocks.getTwitchFollowRelationship.mockResolvedValue(follow);
    readerMocks.resolveTwitchPublicChannel.mockResolvedValue(channel);

    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY)(loadedFixtureEvent, {
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual(identity);
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED)(loadedFixtureEvent, {
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual(accountCreated);
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW)(loadedFixtureEvent, {
        broadcasterId: "c1",
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual(follow);
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL)(loadedFixtureEvent, {
        username: "alice",
      })
    ).resolves.toEqual(channel);

    expect(readerMocks.getTwitchPublicIdentity).toHaveBeenCalledWith("u1", "alice");
    expect(readerMocks.getTwitchAccountCreated).toHaveBeenCalledWith("u1", "alice");
    expect(readerMocks.getTwitchFollowRelationship).toHaveBeenCalledWith("c1", "u1", "alice");
    expect(readerMocks.resolveTwitchPublicChannel).toHaveBeenCalledWith("alice");
  });

  it("maps the unavailable Electron fixture to the same field failures as the browser harness", async () => {
    trustedMainFrame.url = "http://localhost:5173/?userProfileFixture=unavailable";
    const event = loadedFixtureEvent;

    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY)(event, {
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Couldn’t verify" });
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED)(event, {
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW)(event, {
        broadcasterId: "c1",
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL)(event, {
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });

    expect(readerMocks.getTwitchPublicIdentity).not.toHaveBeenCalled();
    expect(readerMocks.getTwitchAccountCreated).not.toHaveBeenCalled();
    expect(readerMocks.getTwitchFollowRelationship).not.toHaveBeenCalled();
    expect(readerMocks.resolveTwitchPublicChannel).not.toHaveBeenCalled();
  });

  it("ignores a fixture query in a packaged app and calls the real reader", async () => {
    electronMocks.app.isPackaged = true;
    const realResult = {
      state: "known",
      source: "official",
      value: {
        userId: "real-user",
        username: "alice",
        displayName: "Real Alice",
        avatarUrl: "https://example.com/alice.png",
      },
    };
    readerMocks.getTwitchPublicIdentity.mockResolvedValue(realResult);

    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY)(loadedFixtureEvent, {
        userId: "real-user",
        username: "alice",
      })
    ).resolves.toEqual(realResult);
    expect(readerMocks.getTwitchPublicIdentity).toHaveBeenCalledWith("real-user", "alice");
  });

  it("routes every Kick profile field through the typed platform boundary", async () => {
    const identity = {
      state: "known",
      source: "official",
      value: { userId: "123", username: "alice", displayName: "Alice", avatarUrl: "" },
    };
    const unavailable = { state: "unavailable", message: "Unavailable" };
    const channel = {
      state: "known",
      source: "official",
      value: { id: "123", username: "alice", displayName: "Alice" },
    };
    readerMocks.getKickPublicIdentity.mockResolvedValue(identity);
    readerMocks.getKickAccountCreated.mockResolvedValue(unavailable);
    readerMocks.getKickFollowRelationship.mockResolvedValue(unavailable);
    readerMocks.resolveKickPublicChannel.mockResolvedValue(channel);
    const request = { userId: "123", username: "alice", channelSlug: "streamer" };

    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_KICK_IDENTITY)(loadedFixtureEvent, request)
    ).resolves.toEqual(identity);
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_KICK_ACCOUNT_CREATED)(loadedFixtureEvent, request)
    ).resolves.toEqual(unavailable);
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_KICK_FOLLOW)(loadedFixtureEvent, request)
    ).resolves.toEqual(unavailable);
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_KICK_CHANNEL)(loadedFixtureEvent, {
        username: "alice",
      })
    ).resolves.toEqual(channel);

    expect(readerMocks.getKickPublicIdentity).toHaveBeenCalledWith("123", "alice", "streamer");
    expect(readerMocks.getKickAccountCreated).toHaveBeenCalledWith("123", "alice", "streamer");
    expect(readerMocks.getKickFollowRelationship).toHaveBeenCalledWith("123", "alice", "streamer");
    expect(readerMocks.resolveKickPublicChannel).toHaveBeenCalledWith("alice");
  });

  it("rejects untrusted senders before calling a profile reader", async () => {
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY)(
        {
          sender: { mainFrame: { url: "https://attacker.example" } },
          senderFrame: { url: "https://attacker.example" },
        },
        { userId: "u1", username: "alice" }
      )
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });

    expect(readerMocks.getTwitchPublicIdentity).not.toHaveBeenCalled();
  });

  it("rejects an allowed-origin child frame inside the trusted window", async () => {
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY)(
        { sender: trustedSender, senderFrame: { url: "http://localhost:5173/embedded" } },
        { userId: "u1", username: "alice" }
      )
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });

    expect(readerMocks.getTwitchPublicIdentity).not.toHaveBeenCalled();
  });

  it("rejects malformed requests before calling a profile reader", async () => {
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY)(loadedFixtureEvent, {
        userId: "",
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });

    expect(readerMocks.getTwitchPublicIdentity).not.toHaveBeenCalled();
  });

  it("turns invalid reader responses and thrown errors into safe field failures", async () => {
    readerMocks.getTwitchPublicIdentity.mockResolvedValueOnce({ state: "known" });
    readerMocks.getTwitchAccountCreated.mockRejectedValueOnce(new Error("private token leaked"));

    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY)(loadedFixtureEvent, {
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });
    await expect(
      getHandler(IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED)(loadedFixtureEvent, {
        userId: "u1",
        username: "alice",
      })
    ).resolves.toEqual({ state: "failed", message: "Unavailable" });
  });
});

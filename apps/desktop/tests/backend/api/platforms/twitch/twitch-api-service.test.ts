import { describe, expect, it, vi } from "vitest";

import { createTwitchApiService } from "@backend/api/platforms/twitch/twitch-api-service";

// Guards: allowlisted renderer capabilities map to fixed Worker-relative Helix paths.
// Guards: access-token refresh and retry ownership stays inside TwitchRequestor rather than IPC payloads.
// Guards: personal block-list mutations await their fixed Helix endpoint and surface provider rejection.
// Guards: semantic slash mutations derive the actor from the current Twitch token and resolve target logins in main.
// Guards: Twitch-declined send-and-pin responses fail instead of reporting a successful command.
describe("Twitch API service", () => {
  it("rejects malformed Helix envelopes at the service boundary", async () => {
    const request = vi.fn().mockResolvedValue({ data: "not-an-array" });
    const service = createTwitchApiService({ request });

    await expect(service.execute({ operation: "get-global-emotes" })).resolves.toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("rejects malformed moderated-channel rows instead of trusting their shape", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [{ broadcaster_id: "100", broadcaster_login: "streamer" }],
    });
    const service = createTwitchApiService({ request });

    await expect(
      service.execute({ operation: "get-moderated-channels", userId: "200" })
    ).resolves.toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("maps moderated-channel discovery to its fixed Worker-relative Helix path", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        {
          broadcaster_id: "100",
          broadcaster_login: "streamer",
          broadcaster_name: "Streamer",
        },
      ],
      pagination: {},
    });
    const service = createTwitchApiService({ request });

    await expect(
      service.execute({ operation: "get-moderated-channels", userId: "200" })
    ).resolves.toEqual({
      ok: true,
      data: [
        {
          broadcaster_id: "100",
          broadcaster_login: "streamer",
          broadcaster_name: "Streamer",
        },
      ],
    });
    expect(request).toHaveBeenCalledWith("/moderation/channels?user_id=200&first=100");
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/token|client.?id/i);
  });

  it("maps chat-settings reads to the fixed Worker-relative Helix path", async () => {
    const settings = { broadcaster_id: "100", slow_mode: true, slow_mode_wait_time: 30 };
    const request = vi.fn().mockResolvedValue({ data: [settings] });
    const service = createTwitchApiService({ request });

    await expect(
      service.execute({ operation: "get-chat-settings", broadcasterId: "100" })
    ).resolves.toEqual({ ok: true, data: settings });
    expect(request).toHaveBeenCalledWith("/chat/settings?broadcaster_id=100");
  });

  it("maps moderation dashboard reads to fixed allowlisted Worker-relative paths", async () => {
    const request = vi.fn().mockResolvedValue({ data: [], pagination: {} });
    const service = createTwitchApiService({ request });
    const cases = [
      [
        { operation: "get-banned-users", broadcasterId: "100" },
        "/moderation/banned?broadcaster_id=100&first=100",
      ],
      [
        { operation: "get-moderators", broadcasterId: "100" },
        "/moderation/moderators?broadcaster_id=100&first=100",
      ],
      [
        { operation: "get-vips", broadcasterId: "100" },
        "/channels/vips?broadcaster_id=100&first=100",
      ],
      [
        {
          operation: "get-unban-requests",
          broadcasterId: "100",
          moderatorId: "200",
          status: "pending",
        },
        "/moderation/unban_requests?broadcaster_id=100&moderator_id=200&status=pending&first=20",
      ],
      [{ operation: "get-polls", broadcasterId: "100" }, "/polls?broadcaster_id=100"],
      [{ operation: "get-predictions", broadcasterId: "100" }, "/predictions?broadcaster_id=100"],
    ] as const;

    for (const [command, path] of cases) {
      await service.execute(command);
      expect(request).toHaveBeenLastCalledWith(path);
    }
  });

  it("maps moderation mutations to fixed paths, methods, queries, and bodies", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{ id: "result" }] });
    const service = createTwitchApiService({ request });

    await service.execute({
      operation: "ban-user",
      broadcasterId: "100",
      moderatorId: "200",
      userId: "300",
      reason: "spam",
    });
    expect(request).toHaveBeenLastCalledWith(
      "/moderation/bans?broadcaster_id=100&moderator_id=200",
      { method: "POST", body: JSON.stringify({ data: { user_id: "300", reason: "spam" } }) }
    );

    await service.execute({
      operation: "delete-chat-message",
      broadcasterId: "100",
      moderatorId: "200",
      messageId: "message-1",
    });
    expect(request).toHaveBeenLastCalledWith(
      "/moderation/chat?broadcaster_id=100&moderator_id=200&message_id=message-1",
      { method: "DELETE" }
    );

    await service.execute({
      operation: "update-chat-settings",
      broadcasterId: "100",
      moderatorId: "200",
      settings: { slow_mode: true, slow_mode_wait_time: 30 },
    });
    expect(request).toHaveBeenLastCalledWith("/chat/settings?broadcaster_id=100&moderator_id=200", {
      method: "PATCH",
      body: JSON.stringify({ slow_mode: true, slow_mode_wait_time: 30 }),
    });
  });

  it("maps channel membership and unban mutations to fixed allowlisted paths", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{ id: "result" }] });
    const service = createTwitchApiService({ request });

    const cases = [
      [
        { operation: "unban-user", broadcasterId: "100", moderatorId: "200", userId: "300" },
        "/moderation/bans?broadcaster_id=100&moderator_id=200&user_id=300",
        "DELETE",
      ],
      [
        { operation: "add-moderator", broadcasterId: "100", userId: "300" },
        "/moderation/moderators?broadcaster_id=100&user_id=300",
        "POST",
      ],
      [
        { operation: "remove-moderator", broadcasterId: "100", userId: "300" },
        "/moderation/moderators?broadcaster_id=100&user_id=300",
        "DELETE",
      ],
      [
        { operation: "add-vip", broadcasterId: "100", userId: "300" },
        "/channels/vips?broadcaster_id=100&user_id=300",
        "POST",
      ],
      [
        { operation: "remove-vip", broadcasterId: "100", userId: "300" },
        "/channels/vips?broadcaster_id=100&user_id=300",
        "DELETE",
      ],
    ] as const;

    for (const [command, path, method] of cases) {
      await service.execute(command);
      expect(request).toHaveBeenLastCalledWith(path, { method });
    }
  });

  it("maps unban-request resolution to its fixed Worker-relative patch", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{ id: "request-1", status: "approved" }] });
    const service = createTwitchApiService({ request });

    await service.execute({
      operation: "resolve-unban-request",
      broadcasterId: "100",
      moderatorId: "200",
      unbanRequestId: "request-1",
      status: "approved",
      resolutionText: "Appeal accepted",
    });

    expect(request).toHaveBeenCalledWith(
      "/moderation/unban_requests?broadcaster_id=100&moderator_id=200&unban_request_id=request-1&status=approved&resolution_text=Appeal+accepted",
      { method: "PATCH" }
    );
  });

  it("maps poll and prediction mutations to fixed Worker-relative paths", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{ id: "result" }] });
    const service = createTwitchApiService({ request });

    await service.execute({
      operation: "create-poll",
      broadcasterId: "100",
      title: "Question?",
      choices: ["One", "Two"],
      duration: 60,
    });
    expect(request).toHaveBeenLastCalledWith("/polls", {
      method: "POST",
      body: JSON.stringify({
        broadcaster_id: "100",
        title: "Question?",
        choices: [{ title: "One" }, { title: "Two" }],
        duration: 60,
      }),
    });

    await service.execute({
      operation: "end-poll",
      broadcasterId: "100",
      pollId: "poll-1",
      status: "TERMINATED",
    });
    expect(request).toHaveBeenLastCalledWith("/polls", {
      method: "PATCH",
      body: JSON.stringify({ broadcaster_id: "100", id: "poll-1", status: "TERMINATED" }),
    });

    await service.execute({
      operation: "create-prediction",
      broadcasterId: "100",
      title: "Outcome?",
      outcomes: ["Yes", "No"],
      predictionWindow: 120,
    });
    expect(request).toHaveBeenLastCalledWith("/predictions", {
      method: "POST",
      body: JSON.stringify({
        broadcaster_id: "100",
        title: "Outcome?",
        outcomes: [{ title: "Yes" }, { title: "No" }],
        prediction_window: 120,
      }),
    });

    await service.execute({
      operation: "end-prediction",
      broadcasterId: "100",
      predictionId: "prediction-1",
      status: "RESOLVED",
      winningOutcomeId: "outcome-1",
    });
    expect(request).toHaveBeenLastCalledWith("/predictions", {
      method: "PATCH",
      body: JSON.stringify({
        broadcaster_id: "100",
        id: "prediction-1",
        status: "RESOLVED",
        winning_outcome_id: "outcome-1",
      }),
    });
  });

  it("maps chat moderation, broadcaster, and pin capabilities to fixed paths", async () => {
    const request = vi.fn().mockResolvedValue({ data: [{ id: "result" }] });
    const service = createTwitchApiService({ request });
    const cases = [
      [
        {
          operation: "warn-user",
          broadcasterId: "100",
          moderatorId: "200",
          userId: "300",
          reason: "stop",
        },
        "/moderation/warnings?broadcaster_id=100&moderator_id=200",
        { method: "POST", body: JSON.stringify({ data: { user_id: "300", reason: "stop" } }) },
      ],
      [
        { operation: "clear-chat", broadcasterId: "100", moderatorId: "200" },
        "/moderation/chat?broadcaster_id=100&moderator_id=200",
        { method: "DELETE" },
      ],
      [
        { operation: "set-shield-mode", broadcasterId: "100", moderatorId: "200", active: true },
        "/moderation/shield_mode?broadcaster_id=100&moderator_id=200",
        { method: "PUT", body: JSON.stringify({ is_active: true }) },
      ],
      [
        { operation: "start-raid", fromBroadcasterId: "100", toBroadcasterId: "300" },
        "/raids?from_broadcaster_id=100&to_broadcaster_id=300",
        { method: "POST" },
      ],
      [
        { operation: "run-commercial", broadcasterId: "100", length: 60 },
        "/channels/commercial",
        { method: "POST", body: JSON.stringify({ broadcaster_id: "100", length: 60 }) },
      ],
      [
        {
          operation: "pin-message",
          broadcasterId: "100",
          moderatorId: "200",
          messageId: "m1",
          durationSeconds: 60,
        },
        "/chat/pins?broadcaster_id=100&moderator_id=200&message_id=m1&duration_seconds=60",
        { method: "PUT" },
      ],
    ] as const;

    for (const [command, path, options] of cases) {
      await service.execute(command);
      expect(request).toHaveBeenLastCalledWith(path, options);
    }
  });

  it("maps native emote reads to fixed Worker-relative paths", async () => {
    const request = vi.fn().mockResolvedValue({ data: [], pagination: {} });
    const service = createTwitchApiService({ request });

    await service.execute({ operation: "get-global-emotes" });
    expect(request).toHaveBeenLastCalledWith("/chat/emotes/global");
    await service.execute({ operation: "get-channel-emotes", broadcasterId: "100" });
    expect(request).toHaveBeenLastCalledWith("/chat/emotes?broadcaster_id=100");
    await service.execute({ operation: "get-emote-set", emoteSetId: "set-1" });
    expect(request).toHaveBeenLastCalledWith("/chat/emotes/set?emote_set_id=set-1");
    await service.execute({ operation: "get-user-emotes", userId: "200", after: "next" });
    expect(request).toHaveBeenLastCalledWith("/chat/emotes/user?user_id=200&after=next");
    await service.execute({ operation: "get-users", userIds: ["1", "2"] });
    expect(request).toHaveBeenLastCalledWith("/users?id=1&id=2");
  });

  it("waits for acknowledged block-list mutations", async () => {
    const request = vi.fn().mockResolvedValue(null);
    const service = createTwitchApiService({ request });

    await expect(
      service.execute({ operation: "block-user", targetUserId: "300" })
    ).resolves.toEqual({ ok: true, data: null });
    expect(request).toHaveBeenLastCalledWith("/users/blocks?target_user_id=300", {
      method: "PUT",
    });

    request.mockRejectedValueOnce(new Error("Twitch rejected the unblock"));
    await expect(
      service.execute({ operation: "unblock-user", targetUserId: "300" })
    ).resolves.toEqual({
      ok: false,
      error: { code: "unavailable", message: "Twitch rejected the unblock" },
    });
  });

  it("derives the actor and resolves targets for semantic moderation commands", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "200", login: "moderator", display_name: "Moderator" }],
      })
      .mockResolvedValueOnce({
        data: [{ id: "300", login: "viewer", display_name: "Viewer" }],
      })
      .mockResolvedValueOnce({ data: [{ id: "ban-1" }] });
    const service = createTwitchApiService({ request });

    await expect(
      service.execute({
        operation: "execute-slash-command",
        channel: { id: "100", login: "streamer" },
        action: { kind: "timeout", targetLogin: "@viewer".slice(1), durationSeconds: 600 },
      })
    ).resolves.toEqual({
      ok: true,
      data: { action: "timeout", targetLogin: "viewer" },
    });
    expect(request.mock.calls).toEqual([
      ["/users"],
      ["/users?login=viewer"],
      [
        "/moderation/bans?broadcaster_id=100&moderator_id=200",
        {
          method: "POST",
          body: JSON.stringify({ data: { user_id: "300", duration: 600 } }),
        },
      ],
    ]);
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/actorId|accessToken|clientId/);
  });

  it("uses POST with a target body to add suspicious-user status", async () => {
    const request = vi.fn();
    const service = createTwitchApiService({ request });
    const identity = { data: [{ id: "200", login: "moderator", display_name: "Moderator" }] };
    const target = { data: [{ id: "300", login: "viewer", display_name: "Viewer" }] };

    request
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ data: [{ user_id: "300" }] });
    await service.execute({
      operation: "execute-slash-command",
      channel: { id: "100", login: "streamer" },
      action: {
        kind: "set-suspicious-status",
        targetLogin: "viewer",
        status: "ACTIVE_MONITORING",
      },
    });
    expect(request).toHaveBeenLastCalledWith(
      "/moderation/suspicious_users?broadcaster_id=100&moderator_id=200",
      {
        method: "POST",
        body: JSON.stringify({ user_id: "300", low_trust_status: "ACTIVE_MONITORING" }),
      }
    );
  });

  it("fails a send-and-pin command when Twitch returns a drop reason", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "200", login: "moderator", display_name: "Moderator" }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            message_id: "message-1",
            is_sent: false,
            drop_reason: { code: "automod_held", message: "The message was held by AutoMod." },
          },
        ],
      });
    const service = createTwitchApiService({ request });

    await expect(
      service.execute({
        operation: "execute-slash-command",
        channel: { id: "100", login: "streamer" },
        action: { kind: "send-and-pin", message: "Important update" },
      })
    ).resolves.toEqual({
      ok: false,
      error: { code: "unavailable", message: "The message was held by AutoMod." },
    });
  });

  it("rejects broadcaster-owned slash actions before mutation when the token owner differs", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      data: [{ id: "200", login: "editor", display_name: "Editor" }],
    });
    const service = createTwitchApiService({ request });

    await expect(
      service.execute({
        operation: "execute-slash-command",
        channel: { id: "100", login: "streamer" },
        action: { kind: "cancel-raid" },
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/users");
  });

  it("maps every semantic slash action family to a fixed Helix request", async () => {
    const request = vi.fn(async (endpoint: string, options?: RequestInit) => {
      if (endpoint === "/users") {
        return { data: [{ id: "100", login: "streamer", display_name: "Streamer" }] };
      }
      if (endpoint.startsWith("/users?login=")) {
        return { data: [{ id: "300", login: "target", display_name: "Target" }] };
      }
      if (endpoint === "/chat/messages") {
        return { data: [{ message_id: "m1", is_sent: true, drop_reason: null }] };
      }
      if (
        options?.method === "DELETE" ||
        endpoint.startsWith("/whispers?") ||
        endpoint.startsWith("/users/blocks?") ||
        endpoint.startsWith("/chat/color?") ||
        endpoint.startsWith("/chat/announcements?") ||
        endpoint.startsWith("/chat/shoutouts?") ||
        endpoint.startsWith("/moderation/moderators?") ||
        endpoint.startsWith("/channels/vips?")
      ) {
        return null;
      }
      return { data: [{ id: "result" }] };
    });
    const service = createTwitchApiService({ request });
    const channel = { id: "100", login: "streamer" };
    const cases = [
      [
        { kind: "update-chat-color", color: "dodger_blue" },
        "/chat/color?user_id=100&color=dodger_blue",
        "PUT",
      ],
      [
        { kind: "whisper", targetLogin: "target", message: "hello" },
        "/whispers?from_user_id=100&to_user_id=300",
        "POST",
      ],
      [{ kind: "block", targetLogin: "target" }, "/users/blocks?target_user_id=300", "PUT"],
      [{ kind: "unblock", targetLogin: "target" }, "/users/blocks?target_user_id=300", "DELETE"],
      [
        { kind: "ban", targetLogin: "target", reason: "spam" },
        "/moderation/bans?broadcaster_id=100&moderator_id=100",
        "POST",
      ],
      [
        { kind: "unban", targetLogin: "target" },
        "/moderation/bans?broadcaster_id=100&moderator_id=100&user_id=300",
        "DELETE",
      ],
      [{ kind: "clear-chat" }, "/moderation/chat?broadcaster_id=100&moderator_id=100", "DELETE"],
      [
        { kind: "update-chat-settings", settings: { slow_mode: false } },
        "/chat/settings?broadcaster_id=100&moderator_id=100",
        "PATCH",
      ],
      [{ kind: "send-and-pin", message: "Pinned" }, "/chat/messages", "POST"],
      [
        { kind: "announce", message: "News" },
        "/chat/announcements?broadcaster_id=100&moderator_id=100",
        "POST",
      ],
      [
        { kind: "shoutout", targetLogin: "target" },
        "/chat/shoutouts?from_broadcaster_id=100&to_broadcaster_id=300&moderator_id=100",
        "POST",
      ],
      [
        { kind: "add-moderator", targetLogin: "target" },
        "/moderation/moderators?broadcaster_id=100&user_id=300",
        "POST",
      ],
      [
        { kind: "remove-vip", targetLogin: "target" },
        "/channels/vips?broadcaster_id=100&user_id=300",
        "DELETE",
      ],
      [{ kind: "run-commercial", length: 60 }, "/channels/commercial", "POST"],
      [
        { kind: "start-raid", targetLogin: "target" },
        "/raids?from_broadcaster_id=100&to_broadcaster_id=300",
        "POST",
      ],
      [{ kind: "cancel-raid" }, "/raids?broadcaster_id=100", "DELETE"],
      [{ kind: "create-stream-marker", description: "Great play" }, "/streams/markers", "POST"],
    ] as const;

    for (const [action, expectedPath, expectedMethod] of cases) {
      request.mockClear();
      const result = await service.execute({
        operation: "execute-slash-command",
        channel,
        action,
      });
      expect(result).toMatchObject({ ok: true });
      expect(request).toHaveBeenLastCalledWith(
        expectedPath,
        expect.objectContaining({ method: expectedMethod })
      );
    }
  });
});

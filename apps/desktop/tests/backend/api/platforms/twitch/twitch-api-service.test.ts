import { describe, expect, it, vi } from "vitest";

import { createTwitchApiService } from "@/backend/api/platforms/twitch/twitch-api-service";

// Guards: allowlisted renderer capabilities map to fixed Worker-relative Helix paths.
// Guards: access-token refresh and retry ownership stays inside TwitchRequestor rather than IPC payloads.
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
});

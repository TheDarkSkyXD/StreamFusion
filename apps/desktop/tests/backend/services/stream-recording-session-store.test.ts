import { describe, expect, it, vi } from "vitest";

import { createStreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import type {
  StreamRecordingJournal,
  StreamRecordingJournalV2,
  StreamRecordingSession,
} from "@shared/stream-recording-types";

function ownedRecoverySession(): StreamRecordingSession {
  return {
    id: "recording-session-1",
    platform: "twitch",
    channelName: "ninja",
    title: "Stream",
    status: "recording",
    destinationPath: "D:\\Videos\\stream.mp4",
    qualityLabel: "Source",
    desiredQuality: { quality: "Source", height: 1080, fps: 60 },
    currentQuality: { quality: "Source", height: 1080, fps: 60 },
    capturedDurationSeconds: 10,
    sections: [
      {
        id: "recording-session-1-part-1",
        path: "D:\\Videos\\stream.streamfusion-recording-session-1-part-001.ts",
        startedAt: "2026-07-11T12:00:00.000Z",
      },
    ],
    gaps: [],
    createdAt: "2026-07-11T12:00:00.000Z",
    updatedAt: "2026-07-11T12:00:10.000Z",
  };
}

function hydrateRecovery(
  session: StreamRecordingSession,
  isSymbolicLink: (filePath: string) => boolean = () => false
) {
  const persisted: StreamRecordingJournalV2 = { version: 2, state: "active", session };
  return createStreamRecordingSessionStore({
    storage: {
      getStreamRecordingJournal: () => persisted,
      saveStreamRecordingJournal: vi.fn(),
    },
    isSymbolicLink,
  });
}

// Guards: persisted recording recovery is versioned and resumes only as an interrupted session
// Guards: completed and failed notices remain transient instead of leaking into the recovery journal
// Guards: renderer snapshots distinguish immutable desired quality from current recovery quality
// Guards: terminal settlement clears recovery durably before one atomic renderer snapshot is emitted
describe("stream recording session store", () => {
  it.each([
    {
      name: "arbitrary same-directory TS path",
      mutate: (session: StreamRecordingSession) => {
        session.sections[0].path = "D:\\Videos\\someone-elses-capture.ts";
      },
    },
    {
      name: "outside path",
      mutate: (session: StreamRecordingSession) => {
        session.sections[0].path =
          "D:\\Outside\\stream.streamfusion-recording-session-1-part-001.ts";
      },
    },
    {
      name: "traversal path",
      mutate: (session: StreamRecordingSession) => {
        session.sections[0].path =
          "D:\\Videos\\..\\Outside\\stream.streamfusion-recording-session-1-part-001.ts";
      },
    },
    {
      name: "mismatched section id",
      mutate: (session: StreamRecordingSession) => {
        session.sections[0].id = "recording-session-1-part-9";
      },
    },
    {
      name: "duplicate section",
      mutate: (session: StreamRecordingSession) => {
        session.sections.push(structuredClone(session.sections[0]));
      },
    },
  ])("rejects a recovery journal with $name", ({ mutate }) => {
    const session = ownedRecoverySession();
    mutate(session);

    expect(hydrateRecovery(session).getJournal()).toEqual({
      version: 2,
      state: "empty",
      session: null,
    });
  });

  it("rejects a symlinked owned section before exposing recovery", () => {
    const session = ownedRecoverySession();

    const store = hydrateRecovery(session, (candidate) => candidate === session.sections[0].path);

    expect(store.getSnapshot()).toEqual({ active: null, notice: null });
  });

  it("rejects a commit checkpoint whose output is not the owned destination or fallback", () => {
    const session = ownedRecoverySession();
    session.status = "finalizing";
    session.recoveryExhaustion = {
      state: "pending-probe",
      error: "interrupted",
      outputPath: "D:\\Outside\\unrelated.mp4",
      outputFormat: "mp4",
      usedFallback: false,
      artifactIdentity: { algorithm: "sha256", digest: "owned", size: 10 },
    };

    expect(hydrateRecovery(session).getSnapshot()).toEqual({ active: null, notice: null });
  });

  it("starts the restart gap at the last durable update instead of app relaunch time", () => {
    const session = ownedRecoverySession();

    const store = hydrateRecovery(session);

    expect(store.getJournal().session?.gaps).toEqual([
      {
        reason: "restart",
        startedAt: "2026-07-11T12:00:10.000Z",
      },
    ]);
  });

  it("keeps a legacy journal without Stream identity as Finalize-only recovery", () => {
    const store = hydrateRecovery(ownedRecoverySession());

    expect(store.getJournal().session?.id).toBe("recording-session-1");
    expect(store.getSnapshot().active).toMatchObject({
      status: "interrupted",
      recoveryFinalizeOnly: true,
      recoveryResumeEligible: false,
      recoveryResumeUnavailableReason: "missing-stream-identity",
    });
  });

  it("closes an open reconnect gap before adding the durable restart gap", () => {
    const session = ownedRecoverySession();
    session.gaps = [{ startedAt: "2026-07-11T12:00:05.000Z", reason: "reconnect" }];

    const store = hydrateRecovery(session);

    expect(store.getJournal().session?.gaps).toEqual([
      {
        reason: "reconnect",
        startedAt: "2026-07-11T12:00:05.000Z",
        endedAt: "2026-07-11T12:00:10.000Z",
      },
      {
        reason: "restart",
        startedAt: "2026-07-11T12:00:10.000Z",
      },
    ]);
  });

  it.each([
    {
      name: "invalid session timestamp",
      mutate: (session: StreamRecordingSession) => {
        session.updatedAt = "not-a-date";
      },
    },
    {
      name: "section ending before it starts",
      mutate: (session: StreamRecordingSession) => {
        session.sections[0].endedAt = "2026-07-11T11:59:59.000Z";
      },
    },
    {
      name: "section after the durable update",
      mutate: (session: StreamRecordingSession) => {
        session.sections[0].startedAt = "2026-07-11T12:00:11.000Z";
      },
    },
  ])("rejects recovery with $name", ({ mutate }) => {
    const session = ownedRecoverySession();
    mutate(session);

    expect(hydrateRecovery(session).getSnapshot().active).toBeNull();
  });

  it("strips signed playlist URLs from new and migrated recovery journals", () => {
    const session = ownedRecoverySession();
    session.desiredQuality = {
      quality: "Source",
      height: 1080,
      url: "https://cdn.example/source.m3u8?token=secret",
    };
    session.currentQuality = {
      quality: "720p60",
      height: 720,
      url: "https://cdn.example/720.m3u8?token=other-secret",
    };
    const migrated = hydrateRecovery(session).getJournal();
    expect(JSON.stringify(migrated)).not.toContain("m3u8");
    expect(migrated.session).toMatchObject({
      desiredQuality: { quality: "Source", height: 1080 },
      currentQuality: { quality: "720p60", height: 720 },
    });

    let persisted: StreamRecordingJournalV2 | null = null;
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => ({ version: 2, state: "empty", session: null }),
        saveStreamRecordingJournal: (journal) => {
          persisted = journal;
        },
      },
      isSymbolicLink: () => false,
    });
    store.saveSession(session);
    expect(JSON.stringify(persisted)).not.toContain("m3u8");
  });

  it.each([
    { version: 99, state: "active", session: null },
    { version: 2, state: "active", session: { id: "missing-fields" } },
  ])("ignores an unsupported or malformed journal without writing it", (persisted) => {
    const save = vi.fn();

    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => persisted,
        saveStreamRecordingJournal: save,
      },
    });

    expect(store.getSnapshot()).toEqual({ active: null, notice: null });
    expect(save).not.toHaveBeenCalled();
  });

  it("settles the matching session with one active-null outcome snapshot after durable clear", () => {
    const events: string[] = [];
    let journal: StreamRecordingJournal = {
      version: 2,
      state: "active",
      session: {
        id: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
        status: "finalizing",
        destinationPath: "D:/Videos/stream.mp4",
        qualityLabel: "source",
        capturedDurationSeconds: 10,
        sections: [
          {
            id: "recording-session-1-part-1",
            path: "D:/Videos/stream.streamfusion-recording-session-1-part-001.ts",
            startedAt: "2026-07-11T12:00:00.000Z",
            endedAt: "2026-07-11T12:00:10.000Z",
          },
        ],
        gaps: [],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:10.000Z",
      },
    };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          events.push("persist");
          journal = next;
        },
      },
    });
    events.length = 0;
    const snapshots: unknown[] = [];
    store.subscribe((snapshot) => {
      events.push("emit");
      snapshots.push(snapshot);
    });

    expect(
      store.settle("recording-session-1", {
        sessionId: "recording-session-1",
        outcome: "completed",
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
        outputPath: "D:/Videos/stream.mp4",
        outputFormat: "mp4",
        artifactIdentity: { algorithm: "sha256", digest: "owned", size: 1 },
      })
    ).toBe(true);

    expect(events).toEqual(["persist", "emit"]);
    expect(snapshots).toEqual([
      {
        active: null,
        notice: expect.objectContaining({
          sessionId: "recording-session-1",
          outcome: "completed",
        }),
      },
    ]);
    expect(journal).toEqual({ version: 2, state: "empty", session: null });
  });

  it("dismisses only the named notice so an older expiry cannot erase a newer outcome", () => {
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => ({ version: 2, state: "empty", session: null }),
        saveStreamRecordingJournal: vi.fn(),
      },
    });
    store.setNotice({
      sessionId: "new-session",
      outcome: "failed",
      platform: "kick",
      channelName: "xqc",
      title: "Stream",
      error: "No playable output",
    });

    expect(store.dismissNotice("old-session")).toBe(false);
    expect(store.getSnapshot().notice?.sessionId).toBe("new-session");
    expect(store.dismissNotice("new-session")).toBe(true);
    expect(store.getSnapshot().notice).toBeNull();
  });
  it("persists a Stream Recording session independently of Downloads", () => {
    let journal: StreamRecordingJournal = { version: 2, state: "empty", session: null };
    const storage = {
      getStreamRecordingJournal: vi.fn(() => journal),
      saveStreamRecordingJournal: vi.fn((next: StreamRecordingJournal) => {
        journal = next;
      }),
    };
    const store = createStreamRecordingSessionStore({ storage });

    store.saveSession({
      id: "recording-session-1",
      platform: "twitch",
      channelName: "ninja",
      title: "Stream",
      status: "preparing",
      destinationPath: "D:\\Videos\\ninja-Stream.mp4",
      qualityLabel: "source",
      capturedDurationSeconds: 0,
      sections: [
        {
          id: "recording-session-1-part-1",
          path: "D:\\Videos\\ninja-Stream.streamfusion-recording-session-1-part-001.ts",
          startedAt: "2026-07-11T12:00:00.000Z",
        },
      ],
      gaps: [],
      createdAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:00.000Z",
    });

    expect(store.getSnapshot()).toEqual({
      active: {
        sessionId: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
        status: "preparing",
        qualityLabel: "source",
        desiredQualityLabel: "source",
        currentQualityLabel: "source",
        qualityChange: null,
        recoveryExhaustionState: null,
        capturedDurationSeconds: 0,
        gapCount: 0,
        hasOpenGap: false,
        openGapStartedAt: null,
        statusMessage: null,
      },
      notice: null,
    });
    expect(storage.saveStreamRecordingJournal).toHaveBeenCalledTimes(1);
    expect(storage.saveStreamRecordingJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        state: "active",
        session: expect.objectContaining({
          sections: [expect.objectContaining({ id: "recording-session-1-part-1" })],
        }),
      })
    );
  });

  it.each([
    "preparing",
    "recording",
    "paused",
    "reconnecting",
    "finalizing",
  ] as const)("hydrates %s as interrupted without starting work", (status) => {
    let journal: StreamRecordingJournal = {
      version: 1,
      session: {
        id: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
        status,
        destinationPath: "D:/Videos/stream.mp4",
        qualityLabel: "source",
        capturedDurationSeconds: 10,
        sections: [
          {
            id: "recording-session-1-part-1",
            path: "D:/Videos/stream.streamfusion-recording-session-1-part-001.ts",
            startedAt: "2026-07-11T12:00:00.000Z",
          },
        ],
        gaps: [],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:10.000Z",
      },
    };
    const save = vi.fn((next: StreamRecordingJournal) => {
      journal = next;
    });

    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: save,
      },
    });

    expect(store.getSnapshot().active?.status).toBe("interrupted");
    expect(store.getJournal()).toMatchObject({
      version: 2,
      state: "interrupted",
      session: {
        status: "interrupted",
        gaps: [expect.objectContaining({ reason: "restart" })],
      },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects an unversioned session without inventing a section identity", () => {
    let legacy: unknown = {
      session: {
        id: "recording-session-legacy",
        platform: "twitch",
        channelName: "ninja",
        title: "Legacy Stream",
        status: "recording",
        destinationPath: "D:/Videos/legacy.mp4",
        qualityLabel: "source",
        capturedDurationSeconds: 3,
        gaps: [],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:03.000Z",
      },
    };
    const save = vi.fn((next: StreamRecordingJournal) => {
      legacy = next;
    });

    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => legacy,
        saveStreamRecordingJournal: save,
      },
    });

    expect(store.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(save).not.toHaveBeenCalled();
  });

  it("publishes a transient outcome notice independently of the active session", () => {
    let journal: StreamRecordingJournal = { version: 2, state: "empty", session: null };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          journal = next;
        },
      },
    });

    store.setNotice({
      sessionId: "recording-session-1",
      outcome: "completed",
      platform: "kick",
      channelName: "xqc",
      title: "Stream",
      outputPath: "D:/Videos/stream.mp4",
      outputFormat: "mp4",
      artifactIdentity: { algorithm: "sha256", digest: "owned", size: 1 },
    });

    expect(store.getSnapshot()).toEqual({
      active: null,
      notice: expect.objectContaining({
        sessionId: "recording-session-1",
        outcome: "completed",
        outputPath: "D:/Videos/stream.mp4",
      }),
    });
    expect(journal).toEqual({ version: 2, state: "empty", session: null });

    const rehydrated = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          journal = next;
        },
      },
    });
    expect(rehydrated.getSnapshot()).toEqual({ active: null, notice: null });
  });

  it("keeps the in-memory recovery journal when durable clear fails", () => {
    const session = {
      id: "recording-session-1",
      platform: "twitch" as const,
      channelName: "ninja",
      title: "Stream",
      status: "interrupted" as const,
      destinationPath: "D:/Videos/stream.mp4",
      qualityLabel: "source",
      capturedDurationSeconds: 10,
      sections: [
        {
          id: "recording-session-1-part-1",
          path: "D:/Videos/stream.streamfusion-recording-session-1-part-001.ts",
          startedAt: "2026-07-11T12:00:00.000Z",
        },
      ],
      gaps: [],
      createdAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:10.000Z",
    };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => ({ version: 1, session }),
        saveStreamRecordingJournal: () => {
          throw new Error("disk full");
        },
      },
    });

    expect(() => store.clearSession()).toThrow("disk full");

    expect(store.getJournal().session).toMatchObject({
      id: "recording-session-1",
      sections: [{ path: "D:/Videos/stream.streamfusion-recording-session-1-part-001.ts" }],
    });
  });

  it("preserves partial identity for an interrupted recovery session", () => {
    const journal: StreamRecordingJournal = {
      version: 1,
      session: {
        id: "recording-session-partial",
        platform: "kick",
        channelName: "xqc",
        title: "Interrupted Stream",
        status: "interrupted",
        destinationPath: "D:/Videos/partial.mp4",
        qualityLabel: "source",
        capturedDurationSeconds: 12,
        sections: [
          {
            id: "recording-session-partial-part-1",
            path: "D:/Videos/partial.streamfusion-recording-session-partial-part-001.ts",
            startedAt: "2026-07-11T12:00:00.000Z",
          },
        ],
        gaps: [],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:12.000Z",
        partial: true,
      },
    };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: vi.fn(),
      },
    });

    expect(store.getSnapshot().active).toMatchObject({
      status: "interrupted",
      partial: true,
    });
  });

  it("retains section identities, cumulative duration, and gaps for interrupted recovery", () => {
    const journal: StreamRecordingJournal = {
      version: 1,
      session: {
        id: "recording-session-sections",
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
        status: "paused",
        destinationPath: "D:/Videos/stream.mp4",
        qualityLabel: "source",
        capturedDurationSeconds: 21,
        sections: [
          {
            id: "recording-session-sections-part-1",
            path: "D:/Videos/stream.streamfusion-recording-session-sections-part-001.ts",
            startedAt: "2026-07-11T12:00:00.000Z",
            endedAt: "2026-07-11T12:00:12.000Z",
          },
          {
            id: "recording-session-sections-part-2",
            path: "D:/Videos/stream.streamfusion-recording-session-sections-part-002.ts",
            startedAt: "2026-07-11T12:00:15.000Z",
            endedAt: "2026-07-11T12:00:24.000Z",
          },
        ],
        gaps: [
          {
            startedAt: "2026-07-11T12:00:12.000Z",
            endedAt: "2026-07-11T12:00:15.000Z",
            reason: "paused",
          },
          { startedAt: "2026-07-11T12:00:24.000Z", reason: "paused" },
        ],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:24.000Z",
      },
    };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: vi.fn(),
      },
    });

    expect(store.getJournal().session).toMatchObject({
      status: "interrupted",
      capturedDurationSeconds: 21,
      sections: [
        { id: "recording-session-sections-part-1" },
        { id: "recording-session-sections-part-2" },
      ],
      gaps: [{ reason: "paused" }, { reason: "paused" }, { reason: "restart" }],
    });
    expect(store.getSnapshot().active).toMatchObject({
      gapCount: 3,
      hasOpenGap: true,
      openGapStartedAt: expect.any(String),
    });
  });
});

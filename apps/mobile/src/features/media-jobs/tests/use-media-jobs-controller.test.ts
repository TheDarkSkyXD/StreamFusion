// @vitest-environment jsdom
import React, { act } from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  asMediaJobId,
  createQueuedMediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";

import {
  MEDIA_JOB_COMMAND_BUSY,
  MEDIA_JOB_RECOVERY_FAILED,
  useMediaJobsController,
} from "../components/use-media-jobs-controller";
import type { MediaJobWorkflow } from "../capabilities/media-jobs";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const now = toSerializedTimestamp("2026-09-12T01:00:00.000Z");

function runningJob() {
  return {
    ...createQueuedMediaJobSnapshot({
      schemaVersion: 1,
      jobId: asMediaJobId("download-1"),
      kind: "download",
      sourceUri: "streamfusion-fixture://download",
      createdAt: now,
    }),
    phase: "running" as const,
    statusMessage: "Running",
  };
}

function renderController(
  workflow: MediaJobWorkflow,
  selectedJobId = "download-1",
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  let latest: ReturnType<typeof useMediaJobsController> | null = null;
  function Harness() {
    latest = useMediaJobsController({ selectedJobId, workflow });
    return null;
  }
  act(() => {
    root.render(React.createElement(Harness));
  });
  return {
    current: () => {
      if (!latest) throw new Error("controller missing");
      return latest;
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

it("serializes user commands and keeps a busy flag until the first settles", async () => {
  expect(ReactDOM.version).toBe(React.version);
  let finish:
    | ((value: { kind: "ok"; snapshot: ReturnType<typeof runningJob> }) => void)
    | undefined;
  const apply = vi.fn(
    () =>
      new Promise<{ kind: "ok"; snapshot: ReturnType<typeof runningJob> }>(
        (resolve) => {
          finish = resolve;
        },
      ),
  );
  const workflow = {
    apply,
    list: vi.fn(async () => [runningJob()]),
    recoverAll: vi.fn(async () => [runningJob()]),
    start: vi.fn(),
  } as unknown as MediaJobWorkflow;
  const rendered = renderController(workflow);
  try {
    await act(async () => {
      await Promise.resolve();
    });
    const first = rendered.current().apply("pause");
    await act(async () => {
      await Promise.resolve();
    });
    expect(rendered.current().model.busy).toBe(true);
    await act(async () => {
      await rendered.current().apply("cancel");
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(rendered.current().model.status).toBe(MEDIA_JOB_COMMAND_BUSY);
    await act(async () => {
      finish?.({ kind: "ok", snapshot: runningJob() });
      await first;
    });
  } finally {
    rendered.unmount();
  }
});

it("keeps the last job list when background recovery fails", async () => {
  const recoverAll = vi
    .fn()
    .mockResolvedValueOnce([runningJob()])
    .mockRejectedValueOnce(new Error("store down"));
  const workflow = {
    apply: vi.fn(),
    list: vi.fn(async () => [runningJob()]),
    recoverAll,
    start: vi.fn(),
  } as unknown as MediaJobWorkflow;
  const rendered = renderController(workflow);
  try {
    await act(async () => {
      await Promise.resolve();
    });
    expect(rendered.current().model.jobs).toHaveLength(1);
    await act(async () => {
      await rendered.current().recover();
    });
    expect(rendered.current().model.jobs).toHaveLength(1);
    expect(rendered.current().model.status).toBe(MEDIA_JOB_RECOVERY_FAILED);
  } finally {
    rendered.unmount();
  }
});

it("does not start a second poll recovery while the first is pending", async () => {
  vi.useFakeTimers({ now: new Date("2026-09-12T01:00:00.000Z") });
  let resolvePoll:
    ((jobs: ReturnType<typeof runningJob>[]) => void) | undefined;
  const recoverAll = vi
    .fn()
    .mockResolvedValueOnce([runningJob()])
    .mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof runningJob>[]>((resolve) => {
          resolvePoll = resolve;
        }),
    )
    .mockResolvedValue([runningJob()]);
  const workflow = {
    apply: vi.fn(),
    list: vi.fn(async () => [runningJob()]),
    recoverAll,
    start: vi.fn(),
  } as unknown as MediaJobWorkflow;
  const rendered = renderController(workflow);
  try {
    await act(async () => {
      await Promise.resolve();
    });
    expect(recoverAll).toHaveBeenCalledTimes(1);
    expect(rendered.current().model.jobs).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(recoverAll).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(1400);
      await Promise.resolve();
    });
    expect(recoverAll).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolvePoll?.([runningJob()]);
      await Promise.resolve();
    });
  } finally {
    rendered.unmount();
  }
});

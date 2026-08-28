import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProcessIoSampler,
  parseTypeperfProcessIoSample,
} from "@/backend/diagnostics/process-io-sampler";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

function createFakeTypeperfProcess() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  return process;
}

// Guards: Windows typeperf's metric-grouped CSV is joined by process instance with parent, rate, and PID identity.
// Guards: partial or terminated-process rows cannot become invented diagnostics values.
// Guards: process churn cannot repeatedly restart typeperf and age valid throughput into an unavailable state.
// Guards: a slow replacement collector cannot interrupt valid throughput from the active collector.
describe("process I/O sampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses grouped process counters into read and write rates by PID", () => {
    const header = [
      "(PDH-CSV 4.0)",
      "\\\\HOST\\Process(electron)\\ID Process",
      "\\\\HOST\\Process(electron#1)\\ID Process",
      "\\\\HOST\\Process(electron)\\Creating Process ID",
      "\\\\HOST\\Process(electron#1)\\Creating Process ID",
      "\\\\HOST\\Process(electron)\\IO Read Bytes/sec",
      "\\\\HOST\\Process(electron#1)\\IO Read Bytes/sec",
      "\\\\HOST\\Process(electron)\\IO Write Bytes/sec",
      "\\\\HOST\\Process(electron#1)\\IO Write Bytes/sec",
    ]
      .map((value) => `"${value}"`)
      .join(",");
    const sample =
      '"08/23/2026 18:42:21.572","100.000000","200.000000","50","100","4096.5","1024","2048","512"';

    expect(parseTypeperfProcessIoSample(header, sample)).toEqual(
      new Map([
        [100, { parentPid: 50, readBytesPerSecond: 4_096.5, writeBytesPerSecond: 2_048 }],
        [200, { parentPid: 100, readBytesPerSecond: 1_024, writeBytesPerSecond: 512 }],
      ])
    );
  });

  it("rejects malformed rows and ignores terminated process instances", () => {
    const header =
      '"(PDH-CSV 4.0)","\\\\HOST\\Process(electron)\\ID Process","\\\\HOST\\Process(electron)\\Creating Process ID","\\\\HOST\\Process(electron)\\IO Read Bytes/sec","\\\\HOST\\Process(electron)\\IO Write Bytes/sec"';

    expect(parseTypeperfProcessIoSample(header, '"time","100"')).toBeNull();
    expect(parseTypeperfProcessIoSample(header, '"time","-1","0","-1","-1"')).toEqual(new Map());
  });

  it("keeps collecting while process-set refresh requests are still arriving", () => {
    let nowMs = 0;
    const children: ReturnType<typeof createFakeTypeperfProcess>[] = [];
    spawnMock.mockImplementation(() => {
      const child = createFakeTypeperfProcess();
      children.push(child);
      return child;
    });
    const sampler = createProcessIoSampler({ platform: "win32", nowMs: () => nowMs });
    const header =
      '"(PDH-CSV 4.0)","\\\\HOST\\Process(electron)\\ID Process","\\\\HOST\\Process(electron)\\Creating Process ID","\\\\HOST\\Process(electron)\\IO Read Bytes/sec","\\\\HOST\\Process(electron)\\IO Write Bytes/sec"';
    const sample = '"time","100","50","4096","2048"';

    sampler.setIntervalMs(1_000);
    children[0].stdout.write(`${header}\n${sample}\n`);

    for (let second = 1; second <= 6; second += 1) {
      nowMs = second * 1_000;
      sampler.refreshProcessSet();
      children[0].stdout.write(`${sample}\n`);
      vi.advanceTimersByTime(1_000);
    }

    expect(sampler.snapshot()).toMatchObject({ kind: "ready", observedAtMs: 6_000 });
    expect(spawnMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    sampler.stop();
  });

  it("keeps the active collector until its replacement produces a valid sample", () => {
    let nowMs = 0;
    const children: ReturnType<typeof createFakeTypeperfProcess>[] = [];
    spawnMock.mockImplementation(() => {
      const child = createFakeTypeperfProcess();
      children.push(child);
      return child;
    });
    const sampler = createProcessIoSampler({ platform: "win32", nowMs: () => nowMs });
    const header =
      '"(PDH-CSV 4.0)","\\\\HOST\\Process(electron)\\ID Process","\\\\HOST\\Process(electron)\\Creating Process ID","\\\\HOST\\Process(electron)\\IO Read Bytes/sec","\\\\HOST\\Process(electron)\\IO Write Bytes/sec"';
    const sample = '"time","100","50","4096","2048"';

    sampler.setIntervalMs(1_000);
    children[0].stdout.write(`${header}\n${sample}\n`);
    sampler.refreshProcessSet();
    vi.advanceTimersByTime(2_000);

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(children[0].kill).not.toHaveBeenCalled();

    for (let second = 3; second <= 8; second += 1) {
      nowMs = second * 1_000;
      children[0].stdout.write(`${sample}\n`);
      vi.advanceTimersByTime(1_000);
    }

    expect(sampler.snapshot()).toMatchObject({ kind: "ready", observedAtMs: 8_000 });
    children[1].stdout.write(`${header}\n${sample}\n`);
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(sampler.snapshot()).toMatchObject({ kind: "ready", observedAtMs: 8_000 });
    sampler.stop();
  });
});

import { describe, expect, it } from "vitest";

import { parseTypeperfProcessIoSample } from "@/backend/diagnostics/process-io-sampler";

// Guards: Windows typeperf's metric-grouped CSV is joined by process instance with parent, rate, and PID identity.
// Guards: partial or terminated-process rows cannot become invented diagnostics values.
describe("process I/O sampler", () => {
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
});

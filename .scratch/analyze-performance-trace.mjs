import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const tracePath = process.argv[2];
if (!tracePath) throw new Error("Usage: node .scratch/analyze-performance-trace.mjs <trace.json>");

const parsed = JSON.parse(await readFile(resolve(tracePath), "utf8"));
if (!Array.isArray(parsed.traceEvents)) throw new Error("Trace must contain traceEvents");

const events = parsed.traceEvents;
const processNames = new Map();
const threadNames = new Map();

for (const event of events) {
  if (event.ph === "M" && event.name === "process_name") {
    processNames.set(event.pid, event.args?.name ?? "unknown");
  }
  if (event.ph === "M" && event.name === "thread_name") {
    threadNames.set(`${event.pid}:${event.tid}`, event.args?.name ?? "unknown");
  }
}

const longTasks = events
  .filter((event) => event.ph === "X" && Number.isFinite(event.dur) && event.dur >= 50_000)
  .map((event) => ({
    durationMs: event.dur / 1_000,
    process: processNames.get(event.pid) ?? `pid:${event.pid}`,
    thread: threadNames.get(`${event.pid}:${event.tid}`) ?? `tid:${event.tid}`,
    name: event.name,
    category: event.cat,
    source: event.args?.data?.url ?? event.args?.src_file ?? null,
  }))
  .sort((left, right) => right.durationMs - left.durationMs);

const profiles = new Map();

for (const event of events) {
  if (event.name !== "ProfileChunk") continue;
  let profile = profiles.get(event.pid);
  if (!profile) {
    profile = {
      nodes: new Map(),
      samples: 0,
      selfFrames: new Map(),
      renderRestartSamples: 0,
      renderRestartApplicationFrames: new Map(),
    };
    profiles.set(event.pid, profile);
  }

  const cpuProfile = event.args?.data?.cpuProfile;
  for (const node of cpuProfile?.nodes ?? []) profile.nodes.set(node.id, node);
  for (const nodeId of cpuProfile?.samples ?? []) {
    const node = profile.nodes.get(nodeId);
    if (!node) continue;
    const frame = node.callFrame ?? {};
    const key = JSON.stringify({
      functionName: frame.functionName || "(anonymous)",
      url: frame.url || "",
      lineNumber: frame.lineNumber ?? null,
      columnNumber: frame.columnNumber ?? null,
    });
    profile.samples += 1;
    profile.selfFrames.set(key, (profile.selfFrames.get(key) ?? 0) + 1);

    const stack = [];
    const visited = new Set();
    let current = node;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      stack.push(current.callFrame ?? {});
      current = profile.nodes.get(current.parent);
    }
    if (stack.some((frame) => frame.functionName === "renderWithHooksAgain")) {
      profile.renderRestartSamples += 1;
      const applicationFrame = stack.find((frame) => /\/src\/frontend\//.test(frame.url ?? ""));
      if (applicationFrame) {
        const applicationKey = `${applicationFrame.url}|${applicationFrame.functionName || "(anonymous)"}`;
        profile.renderRestartApplicationFrames.set(
          applicationKey,
          (profile.renderRestartApplicationFrames.get(applicationKey) ?? 0) + 1
        );
      }
    }
  }
}

function topFrames(profile, predicate, limit = 30) {
  return [...profile.selfFrames]
    .map(([key, samples]) => ({ ...JSON.parse(key), samples }))
    .filter(predicate)
    .sort((left, right) => right.samples - left.samples)
    .slice(0, limit);
}

const cpuProfiles = [...profiles].map(([pid, profile]) => ({
  process: processNames.get(pid) ?? `pid:${pid}`,
  pid,
  samples: profile.samples,
  renderRestartSamples: profile.renderRestartSamples,
  renderRestartApplicationFrames: [...profile.renderRestartApplicationFrames]
    .map(([frame, samples]) => ({ frame, samples }))
    .sort((left, right) => right.samples - left.samples),
  topSelfFrames: topFrames(
    profile,
    (frame) => !["(idle)", "(program)", "(root)"].includes(frame.functionName)
  ),
  topApplicationSelfFrames: topFrames(profile, (frame) =>
    /(?:\/src\/frontend\/|\\apps\\desktop\\out\\main\\)/.test(frame.url)
  ),
}));

process.stdout.write(`${JSON.stringify({ longTasks, cpuProfiles }, null, 2)}\n`);

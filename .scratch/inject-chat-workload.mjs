const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const count = Number(process.argv[3] ?? 250);
const intervalMs = Number(process.argv[4] ?? 20);

if (!Number.isInteger(count) || count <= 0) throw new Error("count must be a positive integer");
if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  throw new Error("interval must be greater than zero");
}

const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const target = targets.find((candidate) => candidate.title === "StreamFusion");
if (!target?.webSocketDebuggerUrl) throw new Error("StreamFusion renderer target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener("open", resolveOpen, { once: true });
  socket.addEventListener("error", rejectOpen, { once: true });
});

function send(method, params = {}) {
  const id = nextId++;
  const result = new Promise((resolveRequest, rejectRequest) => {
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}

const expression = `(async () => {
  const bridge = window.__chatStore;
  if (!bridge) throw new Error("Development chat-store bridge is unavailable");
  const state = bridge.getState();
  const channelKey = Object.keys(state.messagesByChannel)[0];
  if (!channelKey) throw new Error("No active chat channel is available");
  const renderCounters = await import("/src/frontend/components/dev/use-render-count.ts");
  const [platform, channel] = channelKey.split(":", 2);
  state.clearMessages(channelKey);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  renderCounters.resetRenderCounts();
  const before = { ...bridge.counters };
  for (let index = 0; index < ${count}; index += 1) {
    const id = \`perf-\${Date.now()}-\${index}\`;
    state.addMessageBatched({
      id,
      platform,
      type: "message",
      channel,
      userId: \`perf-user-\${index}\`,
      username: \`perf-user-\${index}\`,
      displayName: \`Perf User \${index}\`,
      color: "#ffffff",
      badges: [],
      content: [{ type: "text", content: \`Synthetic performance message \${index}\` }],
      rawContent: \`Synthetic performance message \${index}\`,
      timestamp: new Date(),
      isDeleted: false,
      isHighlighted: false,
      isAction: false
    }, channelKey);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, ${intervalMs}));
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const after = { ...bridge.counters };
  return { channelKey, before, after, renderCounts: renderCounters.getRenderCounts() };
})()`;

const response = await send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});

socket.close();
if (response.exceptionDetails) {
  throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
}
process.stdout.write(`${JSON.stringify(response.result.value, null, 2)}\n`);

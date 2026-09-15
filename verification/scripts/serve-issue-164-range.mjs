import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.MEDIA_JOB_RANGE_PORT ?? 8765);
const payloadBytes = Number(process.env.MEDIA_JOB_RANGE_BYTES ?? 262_144);
const hitLog = process.env.MEDIA_JOB_RANGE_HIT_LOG;
const payload = Buffer.alloc(payloadBytes);
for (let index = 0; index < payloadBytes; index += 1) {
  payload[index] = index % 256;
}
const hits = [];

const server = http.createServer((request, response) => {
  hits.push({
    method: request.method,
    url: request.url,
    range: request.headers.range ?? "none",
    at: new Date().toISOString(),
  });
  if (hitLog) {
    writeFileSync(hitLog, `${JSON.stringify({ hits }, null, 2)}\n`);
  }
  if (request.url !== "/clip.bin") {
    response.statusCode = 404;
    response.end();
    return;
  }
  const rangeHeader = request.headers.range;
  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    const start = Number(match?.[1] ?? 0);
    const end = match?.[2] ? Number(match[2]) : payloadBytes - 1;
    const body = payload.subarray(start, end + 1);
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${payloadBytes}`);
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Length", String(body.length));
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Connection", "close");
    response.flushHeaders();
    response.end(body);
    return;
  }
  response.statusCode = 200;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Length", String(payloadBytes));
  response.setHeader("Content-Type", "application/octet-stream");
  response.setHeader("Connection", "close");
  response.flushHeaders();
  writeSlow(response, payload, 1_500);
});

function writeSlow(response, body, tickMs) {
  let offset = 0;
  let closed = false;
  const chunk = 4_096;
  response.on("close", () => {
    closed = true;
  });
  const tick = () => {
    if (closed || response.writableEnded) return;
    if (offset >= body.length) {
      response.end();
      return;
    }
    const next = Math.min(offset + chunk, body.length);
    response.write(body.subarray(offset, next));
    offset = next;
    setTimeout(tick, tickMs);
  };
  tick();
}

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({
      ready: true,
      port,
      payloadBytes,
      sha256: createHash("sha256").update(payload).digest("hex"),
    })}\n`,
  );
});

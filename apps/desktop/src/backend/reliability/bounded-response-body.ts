export class ResponseBodyTooLargeError extends Error {
  constructor() {
    super("Response body exceeded its size limit");
    this.name = "ResponseBodyTooLargeError";
  }
}

/**
 * Reads a fetch response without first buffering an unbounded body in memory.
 * The byte budget is enforced while the stream is consumed, including when
 * the upstream omits or lies about Content-Length.
 */
export async function readResponseTextWithinLimit(
  response: Response,
  maxBodyBytes: number
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new ResponseBodyTooLargeError();
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBodyBytes) {
        await reader.cancel();
        throw new ResponseBodyTooLargeError();
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

const BACKGROUND_REQUEST_TIMEOUT_MS = 30_000;

function abortError(): Error {
  const error = new Error("The request was aborted.");
  error.name = "AbortError";
  return error;
}

function responseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    headers.append(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }
  return headers;
}

export const backgroundFetch: typeof globalThis.fetch = async (
  resource,
  init,
) => {
  const request = resource instanceof Request ? resource : null;
  const signal = init?.signal ?? request?.signal;
  if (signal?.aborted) throw abortError();

  const url =
    typeof resource === "string"
      ? resource
      : resource instanceof URL
        ? resource.href
        : resource.url;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "HEAD") {
    throw new TypeError(`Background requests do not support ${method}.`);
  }
  const body =
    init?.body === undefined
      ? request && method === "POST"
        ? await request.clone().text()
        : null
      : init.body;
  if (body !== null && body !== undefined && typeof body !== "string") {
    throw new TypeError("Background requests require a string body.");
  }
  if (
    (method === "GET" || method === "HEAD") &&
    body !== null &&
    body !== undefined
  ) {
    throw new TypeError(`${method} requests cannot have a body.`);
  }
  if (signal?.aborted) throw abortError();

  const headers = new Headers(init?.headers ?? request?.headers);
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      xhr.onload = null;
      xhr.onerror = null;
      xhr.ontimeout = null;
      xhr.onabort = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      fail(abortError());
      xhr.abort();
    };
    xhr.onload = () => {
      if (settled) return;
      try {
        if (xhr.status === 0) throw new TypeError("Network request failed.");
        const hasBody =
          method !== "HEAD" &&
          xhr.status !== 204 &&
          xhr.status !== 205 &&
          xhr.status !== 304;
        const response = new Response(hasBody ? xhr.responseText : null, {
          headers: responseHeaders(xhr.getAllResponseHeaders() ?? ""),
          status: xhr.status,
        });
        settled = true;
        cleanup();
        resolve(response);
      } catch (error) {
        fail(
          error instanceof Error
            ? error
            : new TypeError("Invalid network response."),
        );
      }
    };
    xhr.onerror = () => fail(new TypeError("Network request failed."));
    xhr.ontimeout = () => fail(new TypeError("Network request timed out."));
    xhr.onabort = () => fail(abortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      xhr.open(method, url);
      xhr.timeout = BACKGROUND_REQUEST_TIMEOUT_MS;
      headers.forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.send(body ?? null);
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new TypeError("Network request failed."),
      );
    }
  });
};

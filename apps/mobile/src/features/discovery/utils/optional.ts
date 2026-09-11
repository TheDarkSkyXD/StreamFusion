export function requestInit(
  headers: HeadersInit,
  signal?: AbortSignal,
): RequestInit {
  return signal === undefined ? { headers } : { headers, signal };
}

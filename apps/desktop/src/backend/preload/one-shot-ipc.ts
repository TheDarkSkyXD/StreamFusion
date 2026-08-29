/**
 * Adopts an authoritative preload snapshot for the first read only. Every
 * later caller executes the normal request so mutations and forced refreshes
 * can never reuse cold-start data.
 */
export function createOneShotSnapshotRequest<T>(
  startupSnapshot: T | undefined,
  request: () => Promise<T>
): () => Promise<T> {
  let snapshot = startupSnapshot;

  return () => {
    if (snapshot === undefined) return request();
    const result = snapshot;
    snapshot = undefined;
    return Promise.resolve(result);
  };
}

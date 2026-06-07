/**
 * Poll a page's DOM for a readiness condition instead of guessing a fixed delay.
 *
 * Evaluates `predicateExpression` in the page every `intervalMs` until it returns
 * truthy (resolve `true`) or `timeoutMs` elapses (resolve `false`). Resolving
 * `false` on timeout — rather than throwing — is deliberate: callers proceed with
 * "whatever rendered," so a stale/incorrect predicate degrades to the previous
 * fixed-delay behavior instead of becoming a hard error.
 *
 * Used for third-party SPA pages (kick.com) where no first-party "render complete"
 * event exists to await: `did-finish-load` / `dom-ready` fire before the SPA
 * renders the content we need.
 *
 * NOTE: the internal `setTimeout` is the single sanctioned poll timer — there is
 * no async/await equivalent for "poll later in wall-clock time". SP4's lint rule
 * must allowlist this file.
 */

/** Minimal slice of Electron.WebContents this helper needs (electron-free, easily faked in tests). */
interface PollableWebContents {
  executeJavaScript(code: string): Promise<unknown>;
  isDestroyed(): boolean;
}

export async function waitForWebContentsCondition(
  webContents: PollableWebContents,
  predicateExpression: string,
  options: { timeoutMs: number; intervalMs?: number }
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 150;
  const deadline = Date.now() + options.timeoutMs;

  while (Date.now() < deadline) {
    if (webContents.isDestroyed()) return false;
    try {
      const result = await webContents.executeJavaScript(predicateExpression);
      if (result) return true;
    } catch {
      // Per-poll failure (Cloudflare challenge, mid-poll navigation) — treat as
      // "not ready yet" and keep polling until the deadline. If the failure was
      // the webContents being destroyed, stop immediately instead of sleeping.
      if (webContents.isDestroyed()) return false;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

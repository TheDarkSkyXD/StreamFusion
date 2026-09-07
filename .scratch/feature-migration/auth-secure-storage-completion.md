# Authentication secure-storage fallback removal

Before implementation, the feature-owned Windows system contract launched the installed Electron binary with an isolated temporary userData directory and synthetic input only. Actual safeStorage encryption was available, produced different bytes, and decrypted to the original input. The contract passed again after implementation. It creates no window and never opens application stores. [Electron documents Windows safeStorage as using DPAPI](https://www.electronjs.org/docs/latest/api/safe-storage).

Removed the plaintext-as-base64 new-write branch from AuthenticationRepository. OAuth tokens, the separate Twitch follow-write token, and Kick website bearer must encrypt successfully before persistence. Unavailable storage and encryption failure throw clear errors without including token content. Ciphertext still uses base64 serialization in the existing safeStorage envelope; this is not the removed plaintext fallback.

The authTokens update now uses a new object, so a throwing persistence adapter cannot mutate the prior record returned by get(). Cache updates remain after successful persistence.

Legacy marked base64 and unmarked records still decode and validate. Once secure storage is available, valid legacy records are upgraded. An encryption or persistence failure during that upgrade now logs a non-sensitive warning and returns the original valid credential; it no longer masquerades as failed decryption/sign-out. A later repository instance retries migration. Marked safeStorage records never fall through to plaintext decoding.

Verification:
- 514 backend authentication tests passed across 29 files.
- 48 focused credential/restart/cross-feature-storage tests passed (overlaps the authentication suite).
- Real Windows Electron safeStorage system test passed.
- Full TypeScript, scoped ESLint, and 19 feature boundary proofs passed.
- New tests cover all credential families, no writes on unavailable/encryption failures, account/cache preservation on persistence failure, legacy migration failure and later recovery, rejection of mislabelled secure records, and recoverable OAuth refresh persistence failure without auth-lost notification.

Legacy restart fixtures seed synthetic old-format JSON directly instead of calling the now-forbidden insecure production writer. Existing restart assertions remain intact. No real token/store reads, real account mutations, or commits were performed.

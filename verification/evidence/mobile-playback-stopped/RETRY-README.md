# Automatic network playback retry

Implemented and pushed to main as `b37dfda`, following the regression-test commit `e1db60f`.

The native player exhausted Media3's default load retry count during a network outage, then disposed the playback session. Restoring connectivity left both Twitch and Kick on Playback stopped. Saved before snapshots and logs reproduce that failure.

The new native load policy continues retrying temporary connection failures and timeouts with delays capped at five seconds. Media3 retains ownership of scheduling and cancellation. Permanent HTTP errors, TLS failures, parsing failures, and other errors preserve stock limits. Existing live-window recovery remains active.

Validation:

- Red stage: `17 tests completed, 5 failed`; all five expected policy regressions failed and 12 caption lifecycle tests passed.
- Green stage: six policy tests and 12 caption lifecycle tests passed. Broader playback/PiP selection: 34 tests in seven suites, zero failures.
- Independent code review approved the combined playback changes. Comment audit and scoped whitespace checks passed.
- Native APK build: `BUILD SUCCESSFUL in 1m 34s`. Installed debug APK SHA256: `61ED02E750415C989F6452770BA1CFA6847C702878DBA5D95EB6E163D3982DC7`.
- Kick automatically recovered after Wi-Fi/data were disabled at 14:57:25 and restored after 14:58:14. No Retry tap; advancing video frames observed after reconnect.
- Twitch automatically recovered after Wi-Fi/data were disabled at 15:36:10.622 and restored at 15:37:06.950, a 56-second outage. Android settings verified both transports disabled and then enabled. Saved native screenshots show resumed video without a Retry tap, and the native player remained the same session. The dedicated read-only API30 emulator used the same hash-verified native APK and an isolated clean checkout of b37dfda. Earlier attempts on the shared environment were inconclusive and are not counted as passing evidence.
- `verify-network-retry.mjs` passed both providers' saved before/offline/restored UI evidence and the policy/lifecycle regression artifacts. Advancing video was also inspected directly in screenshots; the XML verifier alone does not prove video motion.

Artifacts are local evidence, not a published release. Released APK 0.1.8 does not include this fix. The debug artifact is x86_64 for emulator verification, not a phone release build.

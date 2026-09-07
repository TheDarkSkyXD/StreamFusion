# Twitch session and drag smoothness

1. Read SuperDev principles in full. Completed previously; relevant leaf skills rechecked for this unit.
2. Reproduce sign-out and drag response in Electron, capture baseline.
3. Trace auth HOW and WHY in parallel, distinguish persistence, validation and transient-error behavior.
4. Plan minimal fixes from evidence; delegate bounded implementation; review diff.
5. Repeat original runtime and restart scenarios; compare drag traces; run regression tests.
6. Run no-comments/deslop review, typecheck/lint and required checks.
7. Commit and push main through compiled Electron smoke. No PR per user.

User requires smooth Twitch-like dragging and Twitch authentication retained after app restart. Do not read credentials into tool output or falsely treat transient provider failure as logout.

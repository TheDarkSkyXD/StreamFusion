# Candidate 2

Use a shared host-native `recordingTestPath(fileName)` helper across the recording suites. Keep production validation unchanged.

Add a comprehensive test-only adblock reset and use condition-based waits. Add request-count helpers to EventSub tests.

Store early EventSub revocations in a client-level `Set<string>`. A matching late POST result is discarded. Clear the set on close.

Give every Vitest exception one explicit environment owner. Put the SQLite shim parity test in Node. Keep the two predicate suites in DOM.

Tradeoff. Client-level revocation tombstones are simpler than per-entry state but require explicit lifecycle cleanup. This candidate does not isolate predicate imports from backend storage dependencies.

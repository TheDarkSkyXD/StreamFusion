# Synthesis

Candidate 1 is the base. It scored 34/35 and is the only candidate that breaks the predicate tests' transitive dependency on backend storage and `node:sqlite`.

Graft Candidate 2's request-count wait helpers into the EventSub tests. Keep Candidate 1's per-entry revocation ownership instead of Candidate 2's client-wide tombstone set.

Reject weaker runtime exceptions, higher fixed microtask counts, production acceptance of foreign paths, and Node-only predicate tests. They preserve the wrong boundary or weaken an existing contract.

Verification will run each failure group on clean Linux and Windows, then the full suite, lint, typecheck, the seven-day package policy, and CI on `main`.

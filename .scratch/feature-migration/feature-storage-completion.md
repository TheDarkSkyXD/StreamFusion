# Feature storage completion

Authentication owns encrypted credential records, account identity, token parsing and caching, active-follow selection, pending writes, follow SQL and row mappers, schema migration, and follow-verification persistence. Settings owns preference hydration, normalization, listeners, its schema defaults, renderer key protection, and legacy JSON migration. Discovery owns its persisted followed-stream cache. Existing media-library and moderation repositories remain intact.

StorageService now exposes initialized electron-store access, encryption availability, renderer namespace access, initialization, and its file path. DatabaseService retains connection/integrity/backup/bootstrap and generic key-value operations. No token, preference, follow, recording, download, or moderation forwarding methods remain on either driver. Removed unused window-bound and whole-store-reset entry points have no callers; their persisted keys/defaults remain compatible.

Credential keys live in authentication-store-schema.ts. The combined electron-store schema extends that contract. Follow persistence contracts live in authentication/capabilities/follow-persistence.ts. SQL, schema changes, and row parsing live in authentication/data/follow-repository.ts. Kick verification-cache parsing and its serialized commit queue moved from the provider adapter into authentication/data/kick-follow-verification-repository.ts.

All internal consumers moved to the feature owners. The temporary preferences forwarding factory was deleted. Existing keys, token encodings, legacy credential fallback and upgrade, refresh singleflight callers, guest/account visibility, Kick verification identity, and recording journals are preserved.

Legacy key migration accepts a generic related-migration callback. SQLite runs both shared key changes and feature follow imports inside one transaction. This avoids nested transactions while retaining rollback across ownership boundaries. A new real SQLite failure-injection assertion verifies rollback of both owners. Existing test assertions and Guards contracts remain intact.

Validation:

- verify-storage-extraction.mjs compares tokenized method bodies against the pre-extraction snapshots. All 71 extracted methods match apart from the intentional receiver change from the shared database to the follow repository. Those methods are absent from the shared drivers.
- storage-tests-final.log contains 26 passed files and 567 passed assertions, including credentials, account restart, follow ownership/sync, SQLite migrations, preference hydration, persistence namespaces, and discovery caching.
- storage-object-mocks-tests.log contains 3 passed files and 101 passed assertions after redirecting old object mocks to the owning repository.
- A full Node pass before provider facade changes reported 234 passed files and three stale storage-mock failures. Those three were repaired and passed independently. The final whole Node pass reported 234 passed files and six failures in three files from concurrent provider facade changes. See storage-node-final.log. Provider owner was notified.
- Full desktop TypeScript checking passed immediately after the first extraction. Latest checking has no storage-related errors, but concurrent provider endpoint changes and two frontend UserPopout optional-value errors remain in storage-typecheck-final.log. Root/provider owners were notified.
- Storage source and test lint is clean. The broader changed-caller list currently reports four provider adapter-to-composition violations caused by concurrent facade ownership work, recorded in storage-lint-final.log. Provider owner was notified.

No files moved wholesale and no commits were created. Extraction and caller scripts, method maps, pre-extraction snapshots, a rerunnable method-preservation check, and validation logs are under .scratch/feature-migration. storage-owned-files.json records the files touched by this work, including mechanical caller and mock migrations.

Build the Lever shaped the deterministic caller codemod and method-preservation checker. Migrate Callers Then Delete Legacy APIs shaped removal of old driver methods and the preference forwarding factory. Model the Domain shaped ownership of credential schema, follow row mappings, and the preference repository. Type System Discipline moved pending-follow contracts into capabilities so callers do not depend on concrete SQL for their types.

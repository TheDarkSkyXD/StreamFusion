# Auth folder repair

- [x] Read Principles. Fix Root Causes keeps the documented feature structure and restores its Git representation. Prove It Works uses the failing architecture command and a checkout of the staged placeholder.
- [x] Reproduce architecture:features failure. dc8f1c1 moved the final auth/utils helper to core; Git no longer preserves the required empty folder.
- [x] Add the existing .gitkeep convention without application code changes.
- [x] Verify architecture:features and confirm a Git checkout recreates auth/utils.
- [x] Commit and push main, preserving pre-existing telemetry and scratch evidence.


Delivered aa52de6 to main. Architecture check and required compiled Electron smoke passed. Existing telemetry retained its original SHA256. Temporary preservation stash restored and removed.


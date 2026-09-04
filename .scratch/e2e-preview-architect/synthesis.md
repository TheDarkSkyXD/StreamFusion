# E2E Preview synthesis

Candidate A is the base. Its managed `session --mode preview` command gives the root picker a foreground process and automatic cleanup. Candidate B's explicit-cleanup path leaves lifecycle work with the user.

The implementation keeps Candidate A's closed launch-mode registry and discriminated launcher identity. It adopts Candidate B's `control-launch-plan.mjs` name, package-policy assertion, and explicit guarantee that preview never uses `--skipBuild`.

The core data shape is `VerificationLaunchPlan`. A two-row registry maps `dev:electron` and `preview` to npm arguments, persisted launcher metadata, and readiness timeout. The controller parses CLI input once, rejects caller attempts to replace its CDP port or profile, and consumes one plan without mode branches.

The root picker gains one table row. The `e2e:preview` script runs a managed controller session. Development proof remains the controller default. Playwright and a second controller are rejected because both duplicate the existing E2E boundary.

Verification requires focused Node tests plus one real picker-driven preview. The live pass must show the compiled renderer, a healthy controller report, automatic run-directory cleanup, and retained evidence.

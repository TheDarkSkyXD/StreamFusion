# Mobile workflow implementation

## Completion criteria

Production mobile routes expose authenticated chat, emote selection and rendering, recorded chat replay, a moderation workspace, provider-supported engagement actions, multistream slot management and playback, and caption controls. User actions call real capabilities. Unsupported provider or native operations disclose their exact limitation and never simulate success. Controllers own cancellation, account changes, disposal, and failure states. Meaningful behavior tests, type checking, lint, source coverage and running UI checks pass before a direct-main commit.

## Workflow

- [x] Read the Principles section of the SuperDev mode skill.
- [x] Phase A. Frame the work and define completion criteria.
- [x] Phase B. Design the workflow and compare integration shapes.
- [x] Architect: Ground, Sketch, Agree, Implement, Scrap when required.
- [x] Swarm: Frame, Fan out, Aggregate, Report.
- [x] Phase C. Run the loop.
- [x] Trace auth, provider transports, focused playback, native captions and test seams.
- [x] Implement chat send, emotes, user actions, and recorded replay in an isolated worktree.
- [x] Implement role-checked moderation and provider-supported polls and predictions in an isolated worktree.
- [x] Implement caption controls with honest model and recognizer readiness in an isolated worktree.
- [x] Implement multistream sessions, add/remove, single audio owner, lifecycle cleanup, and route wiring.
- [x] Integrate each feature through the production composition root and update source coverage.
- [x] Phase D. Keep the audit trail.
- [x] Phase E. Verify and hand back.
- [x] Complete independent review.

Delivery uses a direct-main commit and push after the repository's pre-commit smoke gate.

## Ownership and design gate

Each worker owns its feature files in its own checkout. The integration owner alone edits the app composition root, shared shell route files, dependency manifests and coverage registry. Feature-owned tests are included by the existing Vitest glob. Two independently grounded sketches compare reuse of existing session ports with consolidated provider operation ports before implementation.

The throughput checkpoint is an actual production component exercised through an injected real feature controller and deterministic provider response. Each unit must prove the outgoing operation, resulting state, failure path and disposal. Final UI checks render production components, rather than the earlier fixture mockups.

Provider tokens are obtained from the existing authenticated session. Production actions never consume development account fixtures. Permission errors request reconnection with missing scopes. A native recognizer must produce transcript text from decoded audio before local captions can be described as implemented transcription.

The existing user changes in the original checkout, including `.agents/` and `package.json`, remain outside this work. No pull request is created.

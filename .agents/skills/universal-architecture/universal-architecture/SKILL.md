---
name: universal-architecture
description: 'Automatically activate for architecture and code-placement work even when the user does not name this skill. Trigger on natural requests such as "Where should this code go?", "Review or fix our architecture", "Can this layer import that layer?", "Separate business logic from routes or controllers", "Organize our web, mobile, desktop, server, worker, CLI, offline, or local-first code", and "Enforce boundaries with ESLint"; also use for UI, API, RPC, IPC, transport, domain, capabilities, vendors, adapters, databases, persistence, dependency direction, or layer-violation questions. Explicitly invoking universal-architecture for an existing project authorizes a safe, incremental migration to this layer system unless the request says review, audit, explain, plan, read-only, no changes, or otherwise narrows the scope. When implementing or refactoring architecture in JavaScript or TypeScript, make enforceable dependency boundaries executable through ESLint and CI unless the user explicitly opts out.'
---

# Universal architecture

Apply a responsibility-based architecture without forcing unnecessary packages or abstractions. Detect the active platforms and existing repository conventions before proposing changes.

## Workflow

1. Determine whether the skill was explicitly invoked or activated automatically, then identify the user's intent: design, placement decision, audit, enforcement, explanation, or implementation.
2. Load the mandatory reference files specified below before analyzing or acting. Do not answer from this summary alone.
3. Inspect the repository when the request concerns existing code. Determine platforms, entry points, workspace packages, aliases, build tools, tests, and current dependency direction.
4. Classify code by responsibility rather than its current directory name.
5. Separate runtime call flow from source-import direction, especially when dependency inversion is used.
6. Preserve existing conventions where they support the boundaries. Do not manufacture a migration solely to match example paths.
7. For audits, cite concrete files and imports.
8. For implementation or refactoring, make scoped edits, encode every new or changed enforceable dependency boundary in the repository's normal tooling, and run proportionate verification.
9. Do not edit when the user asked only for a review, explanation, design, placement decision, or diagnosis. Recommend enforcement opportunities without applying them.

## Explicit invocation and migration

When the user explicitly names, selects, or tells the agent to use `universal-architecture` against an existing project, treat that invocation as authorization to implement a repository migration to this layer system. Do not stop after a report or require a second instruction to "fix" or "restructure" the project. The same request remains read-only when it explicitly asks for a review, audit, explanation, plan, diagnosis, read-only work, no changes, or a narrower task that does not authorize the wider migration.

Automatic activation from an ordinary architecture or placement question does not broaden write authorization. Answer or inspect read-only unless the user's request independently authorizes implementation or refactoring.

For an authorized repository migration:

1. Audit and map existing responsibilities into UI, Transport, Domain, Capabilities, Vendor or platform adapters, Supporting foundations, and composition roots.
2. Reuse suitable existing locations and create the layer locations required by all existing in-scope responsibilities. Do not scaffold empty unused layers unless the user explicitly requests the complete skeleton.
3. Move or split misplaced code in safe, incremental stages. Preserve observable behavior and avoid an uncontrolled big-bang rewrite.
4. After each stage, repair affected imports, aliases, exports, tests, workspace manifests, build configuration, entry points, and composition wiring.
5. Apply executable ESLint and CI dependency boundaries as described by the enforcement policy, including narrow temporary exceptions only where a brownfield migration genuinely requires them.
6. Verify relevant lint, type-check, tests, build, and representative allowed and forbidden boundary cases after migration stages.
7. Continue through the authorized in-scope migration without requesting redundant confirmation. Pause only for a genuinely material design choice, destructive risk, missing authority, or external blocker that prevents safe progress.

## Path naming workflow

Before an implementation or refactor creates or renames files or folders:

1. Inspect the nearest relevant project instructions, local directory patterns, framework or tool conventions, and the dominant convention for the same artifact type.
2. Treat file and folder names separately from code identifiers; different artifact types may use different conventions.
3. If the evidence is coherent, follow it silently. If no convention exists, or the evidence conflicts and the choice materially affects the change, ask one concise question about whether the affected files or folders should use kebab-case, camelCase, snake_case, PascalCase, or another convention.
4. Do not ask for review or explanation tasks, or for changes that create or rename no paths. Do not rename unrelated existing paths merely to normalize naming.
5. If the user chooses a repository-wide convention, document or enforce it where appropriate and within scope.

## Layer folder creation workflow

Apply this workflow only during an authorized implementation or refactor that needs a responsibility or layer location:

1. Inspect the repository, workspace structure, applicable instructions, and local conventions before creating a path.
2. Reuse an existing location with the equivalent responsibility even when its name differs from this skill's examples.
3. If no suitable location exists, create only the smallest folder or package needed for the current feature and apply the path naming workflow. Paths such as `packages/core`, `packages/shared`, `packages/database`, `packages/capabilities/*`, `packages/adapters/*`, and UI or Transport paths are examples, not mandatory names or structure.
4. Do not scaffold empty or unused layers, create a complete example tree, or reorganize unrelated paths. Do not create folders during a review, explanation, design, placement decision, or audit.
5. When creating a location, update only the in-scope workspace manifests, aliases, exports or entry points, ESLint boundary classifications and rules, and CI or test configuration needed for the new path to be recognized and enforced.
6. Verify the relevant lint, type-check, test, build, and boundary-test paths include the new location.

## Mandatory reference loading

The reference files contain the detailed rules intentionally removed from this short file. Use them as required inputs, not optional background reading.

1. **Always read [references/layers.md](references/layers.md)** for every skill activation. It defines layer ownership, ports, adapters, foundations, and placement decisions.
2. **Also read [references/transport.md](references/transport.md)** whenever the request involves HTTP, RPC, GraphQL, IPC, native bridges, webhooks, queues, cron, workers, CLI, authentication, middleware, request validation, or application entry points.
3. **Also read [references/platforms-and-offline.md](references/platforms-and-offline.md)** whenever the request involves web/mobile/desktop flows, cross-platform sharing, deep links, push, payments, files, analytics, configuration, offline behavior, or synchronization.
4. **Also read [references/enforcing-boundaries-with-eslint.md](references/enforcing-boundaries-with-eslint.md)** whenever the request involves ESLint, imports, automated enforcement, dependency inversion, monorepo boundaries, exceptions, rollout, or CI.
5. **Read all four reference files** for a full architecture design, repository-wide audit, cross-platform refactor, or boundary-enforcement implementation.

If the request expands during the task, load every newly relevant reference before continuing. Resolve these paths relative to this `SKILL.md`. Do not claim a reference is unavailable without checking the skill's `references/` directory.

## Core model

Use six responsibility layers:

1. UI
2. Transport and application entry points
3. Domain
4. Capabilities
5. Vendor and platform adapters
6. Supporting foundations

Representative runtime flow:

```text
UI
→ Transport or application entry point
→ Domain
→ Capability port
→ concrete vendor/platform/persistence adapter
```

Typical source-import direction under dependency inversion:

```text
UI → Transport client and Shared
Server Transport → Domain and Shared
Domain → Capability ports and Shared
Concrete adapters → the ports they implement and Shared
Composition root → consumers plus concrete implementations for wiring
```

Runtime arrows are not automatically source-import arrows. A Capability port must not import its concrete adapter. Put wiring in an explicit composition root and prevent circular package dependencies.

## Non-negotiable boundaries

- UI renders and collects input; it does not own authoritative business rules, persistence, privileged SDKs, or unrestricted OS access.
- Transport parses and translates delivered messages, performs boundary validation and authentication, applies coarse access control, invokes Domain, and maps responses. It does not own product decisions or arbitrary queries.
- Domain owns business rules, invariants, workflows, entity-specific authorization, and business errors. It remains independent of delivery frameworks and concrete infrastructure.
- Capabilities expose small application-owned ports for external or platform operations. They do not leak provider terminology or SDK types.
- Vendor, device, OS, and persistence adapters implement ports and normalize concrete behavior. They do not decide business policy.
- Shared foundations contain only stable, framework-independent contracts and primitives. They must not become a dumping ground.
- Composition roots may import several layers only to construct and inject dependencies. They must not accumulate business logic.
- Split modules that combine responsibilities instead of granting shortcut dependencies.

## Universal placement questions

- Does it display information or collect user input? UI.
- Does it receive, parse, authenticate, validate, or translate a delivered message? Transport.
- Does it decide what the product should do? Domain.
- Does it define a stable operation needed from a service, device, or operating system? Capability.
- Does it use a specific SDK, provider, native API, database, or operating-system API? Adapter or persistence implementation.
- Is it a stable framework-independent contract or primitive? Shared foundation.
- Does it construct the application and connect ports to implementations? Composition root.

## Enforcement policy

Architecture rules should become executable where the language and tooling allow it.

### Implementation completion gate

When an implementation or refactor creates, moves, or changes an enforceable dependency seam, executable enforcement is part of the architecture work rather than an optional follow-up, unless the user explicitly opts out.

For JavaScript and TypeScript repositories:

1. Inspect the existing ESLint version, configuration format, package manager, aliases, package exports, and current architectural rules before editing.
2. Add or update repository-specific `eslint-plugin-boundaries` classifications and dependency policies for layer-to-layer rules.
3. Add or update `no-restricted-imports` entries for explicit SDK, runtime, feature-internal, alias, and deep-import bans. Give each targeted restriction a message that names the approved interface or location.
4. Use package `exports`, TypeScript project references, cycle rules, or workspace controls when they materially close gaps ESLint alone cannot cover.
5. Keep composition roots, tests, migrations, generated files, stories, and fixtures explicitly classified. Make any exception narrow and documented.
6. Put the architecture rules in the repository's normal lint and CI paths, configure them as errors, and ensure CI rejects their violations.
7. Prove the policy: run the intended lint scope, confirm representative allowed imports pass, confirm representative forbidden imports fail, and test both aliases and relative paths against bypasses.

For a greenfield or already-clean area, enable the complete applicable policy as errors. For a brownfield area with existing violations, inventory existing violations within the intended enforcement scope, fix straightforward violations, protect new or clean areas immediately, and use only narrow temporary exceptions for the remaining migration. Do not leave the architecture permanently warning-only.

If the repository language or tooling cannot encode a boundary, state the residual manual review requirement and why it cannot be automated. Do not claim the architecture implementation is complete without executable enforcement, a documented technical limitation, or a documented user-approved opt-out.

Read the ESLint reference before proposing or editing boundary configuration.

## Output

Report only what serves the request. A full design or audit should include:

1. Detected platforms and entry points
2. Proposed or observed layer map
3. File and package ownership decisions
4. Runtime communication paths
5. Source-import policy
6. Violations or suspicious dependencies with evidence
7. Platform-specific and persistence adapters
8. ESLint enforcement status when applicable
9. Recommended changes in priority order
10. Verification performed or still needed

Prefer concrete repository paths and examples over abstract advice. Keep simple applications simple while preserving the important boundaries.

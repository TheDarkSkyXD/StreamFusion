---
name: streamfusion-feature-map
description: "StreamFusion project feature map. Use whenever changing, debugging, reviewing, testing, or locating a StreamFusion feature across the Electron renderer, preload bridge, main process, Twitch or Kick adapters, storage, or Kick OAuth worker. Read this before deciding where StreamFusion feature code belongs."
---

# StreamFusion feature map

Use this skill to find the complete path for a StreamFusion feature before editing it. StreamFusion is an Electron desktop app that presents Twitch and Kick through one product model. A small Cloudflare Worker handles Kick OAuth token operations only.

## Start here

1. Read the root `AGENTS.md` and `CONTEXT-MAP.md`.
2. Read [`references/features.md`](references/features.md) and select the user-facing feature group.
3. Open `apps/desktop/CONTEXT.md` for desktop work or `apps/worker/CONTEXT.md` for Kick OAuth worker work.
4. Read the nearest `AGENTS.md` for every file you may edit.
5. Trace the feature through renderer, preload, IPC, service or Platform adapter, state, and tests. Skip layers the feature does not use.

## Placement rules

- Each implemented feature owns `routes`, `components`, `domain`, `capabilities`, `adapters`, `data`, `utils`, `composition`, and `tests` under its runtime's `features/<feature>/` root.
- Desktop feature roots live separately under `src/frontend/features/` and `src/backend/features/`. Preserve the Electron process boundary.
- Put screens, presentation hooks, and view state in the owning feature's `components/`. Keep route registration in `src/frontend/routes/router.tsx`.
- Keep business rules in `domain/`, provider-neutral ports in `capabilities/`, concrete integrations in `adapters/`, persistence in `data/`, and dependency wiring in `composition/`.
- Put feature tests in that feature's `tests/`; retain only shared test infrastructure and cross-feature integrations in workspace test directories.
- Shared UI primitives, runtime bootstrap, translation infrastructure, and shared contracts remain outside feature roots when they have no single feature owner.
- When another view previews existing content, reuse its renderer and display preferences so both views stay consistent.
- Reuse identity styling in profile summaries as well as content rows, including provider colors, cosmetics, and display preferences.
- Show privileged actions from the current account's verified capability for the active resource. A callback's presence does not establish permission.
- Before removing a control, verify that its replacement interaction works and remains accessible.
- When matching reference controls, compare visible glyph bounds at the same display density. Equal icon canvas sizes do not establish equal visual sizes.
- Cross the Electron boundary only through `electronAPI`, shared contracts, preload, and a registered IPC handler.
- Put provider-neutral reads behind `IPlatformReader`. Put Twitch-only or Kick-only behavior behind a narrow capability interface or the provider adapter.
- Put filesystem, database, network, FFmpeg, Electron, and credential work in the main process.
- Put only Kick OAuth exchange, refresh, and rate limiting in `apps/worker/`. The Worker does not proxy product data.

## Working contract

Identify the affected app before choosing a feature owner or verification tool. When a report leaves the platform unclear, keep investigation read-only until the target is confirmed.

Before changing a feature, report its route or user entry point, renderer owner, process boundary, main-process owner, Platform-specific branch, state owner, and closest tests. Search by exported symbol and IPC channel instead of trusting this map blindly. The map routes investigation. Current source proves behavior.

Verify discovery with exact and partial queries, each provider filter, and results beyond the first page. Check that All exposes available provider results. Compare unique item identities across pages; a changing cursor alone does not prove continuation.

When a change adds a new top-level user capability or moves ownership between feature groups, update [`references/features.md`](references/features.md) in the same change.

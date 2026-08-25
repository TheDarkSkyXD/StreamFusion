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

- Put pages and route composition in `apps/desktop/src/pages/` and `apps/desktop/src/routes/router.tsx`.
- Put reusable UI in `apps/desktop/src/components/`. Use the existing feature subdirectory.
- Put renderer orchestration and server-state reads in `apps/desktop/src/hooks/`.
- Put durable renderer state in `apps/desktop/src/store/`. Do not duplicate server state already owned by TanStack Query.
- Cross the Electron boundary only through `electronAPI`, shared contracts, preload, and a registered IPC handler.
- Put provider-neutral reads behind `IPlatformReader`. Put Twitch-only or Kick-only behavior behind a narrow capability interface or the provider adapter.
- Put filesystem, database, network, FFmpeg, Electron, and credential work in the main process.
- Put only Kick OAuth exchange, refresh, and rate limiting in `apps/worker/`. The Worker does not proxy product data.

## Working contract

Before changing a feature, report its route or user entry point, renderer owner, process boundary, main-process owner, Platform-specific branch, state owner, and closest tests. Search by exported symbol and IPC channel instead of trusting this map blindly. The map routes investigation. Current source proves behavior.

When a change adds a new top-level user capability or moves ownership between feature groups, update [`references/features.md`](references/features.md) in the same change.

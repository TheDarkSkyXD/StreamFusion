# Media retention fixes

The red run used the migrated working tree before these two production fixes.
No user playback buffers, quality policy, or watchdog thresholds changed.

## Reproduction before editing production

Command `node .scratch/feature-migration/media-retention-repro.cjs` exited 1.
The source adapter retained 100 quality listeners after 100 source lifecycles.
The Following preloader retained 10,000 Image objects after 10,000 unique URLs.
Output is in `media-retention-red.log`.

The regression command was:

```powershell
npm run --workspace streamfusion test -- src/frontend/features/playback/tests/components/player/hls-player-source-reuse.test.tsx src/frontend/features/discovery/tests/pages/Following.test.tsx
```

It failed two tests and passed 57. The real HlsPlayer source-switch lifecycle
retained 101 listeners instead of one. Following unmount left pending preload
sources attached. Output is in `media-retention-tests-red.log`.

## Changes

The HLS session keeps its quality handler identity and removes that exact
listener during effect cleanup. The same live HLS instance remains reused.

Category thumbnail preloading now owns at most 24 unique images per current
effect. Load and error handlers remove completed images from the pending set
and clear both callbacks. Effect teardown cancels the remaining sources and
clears the set. No image element remains in a module-global cache.

## Verification

The identical two-suite regression command passed 59 tests after the fixes.
Output is in `media-retention-tests-green.log`.

```powershell
npm run --workspace streamfusion test -- src/frontend/features/playback/tests/components/player/hls-player-source-reuse.test.tsx src/frontend/features/playback/tests/components/player/hls-player-stall-watchdog.test.tsx src/frontend/features/playback/tests/components/player/hls-player.test.tsx src/frontend/features/discovery/tests/pages/Following.test.tsx src/frontend/features/discovery/tests/adapters/browser/category-thumbnail-preloader.test.ts
```

The expanded run passed 75 tests across five suites. It also verifies the
24-image limit, duplicate URLs, successful/error completion, pending teardown,
return visits, and both playback watchdog behavior and source reuse.
Output is in `media-retention-focused.log`.

Desktop TypeScript, scoped ESLint and `architecture:features` passed. The
source-level HLS replay now retains one quality listener after 100 source
lifecycles. The old category preloader no longer exists; its replacement is
covered by the real DOM image tests above.

These checks prove the two ownership defects are removed. They do not quantify
their contribution to the observed native renderer/GPU private-memory usage.

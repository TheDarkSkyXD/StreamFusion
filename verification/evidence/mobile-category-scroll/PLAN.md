# Mobile category scrolling

1. Ground and reproduce the growing category list.
2. Compare a two-column FlatList with explicit paired rows.
3. Implement one bounded category grid and preserve provider pagination.
4. Verify paging, provider selection, search, and loading behavior. Commit only task files and push main.

## Throughput checkpoint

- Blocking first steps. Read mobile ownership and trace the existing paging and scroll container before changing source. Capture the original list with the same deterministic catalog used after the fix.
- Independent workstreams. Design candidates write separate files. The verification story owns its own file. Runtime verification remains with the parent.
- Shared mutable state. One implementation worker owns the category screen, hook, and associated tests. The parent reviews and performs Git operations.
- Smallest safe decomposition. Keep the paging contracts and adapters. Change only rendering and repeated catalog projections in the existing discovery feature.

## Verification limits

The native Device connector is disabled. Android shell commands are being checked independently. Storybook runs the production screen and query hook with deterministic provider reads. Browser evidence can establish bounded mounted cards and paging behavior, but cannot establish native frame rate.

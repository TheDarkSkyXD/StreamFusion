# Shared renderer hooks

This directory owns only capability-neutral React hooks: `useAfterFirstPaint`,
`useDebounce`, `useInterval`, `useManagedTimeout`, `useMediaQuery`, and `useTimeout`.
Feature presentation hooks belong in `frontend/features/<feature>/components/`.
Runtime APIs belong in the owning feature's adapters, behind typed capabilities.

- Store the latest timer callback in a ref so callback changes do not restart timers.
- Unsubscribe listeners and cancel timers when a hook unmounts or its resource changes.
- Cancel asynchronous work, or ignore stale results before updating state.
- Use narrow Zustand selectors. Avoid allocating a new selected object every render.
- Keep provider/network queries and their keys with the feature. Shared hooks must not
  import a feature merely to supply a default dependency.
- Do not recreate the deleted hooks barrel or feature forwarding modules here.

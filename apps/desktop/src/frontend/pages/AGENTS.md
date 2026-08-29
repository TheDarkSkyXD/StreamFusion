# Route Pages

- Every route-level screen owns a named folder under this directory.
- A page composes feature APIs and shared frontend UI; reusable feature behavior belongs in `frontend/features/<feature>/`.
- Keep lazy-loading and route search validation in the owning feature's `routes/` folder.
- Register URL paths only in `frontend/routes/router.tsx`.
- Do not recreate a central page barrel that eagerly imports all page modules.

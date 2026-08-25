# Domain docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **Context-scoped ADRs**: also check `<context>/docs/adr/` for decisions local to that context.

If any of these files don't exist, **proceed silently**. Don't flag their absence or suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

This repo uses a multi-context layout:

```text
/
|-- CONTEXT-MAP.md
|-- docs/adr/                  # System-wide decisions
`-- apps/
    |-- desktop/
    |   |-- CONTEXT.md
    |   `-- docs/adr/          # Desktop-specific decisions, when needed
    `-- worker/
        |-- CONTEXT.md
        `-- docs/adr/          # Worker-specific decisions, when needed
```

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept isn't in the glossary yet, reconsider whether the project uses that language or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.

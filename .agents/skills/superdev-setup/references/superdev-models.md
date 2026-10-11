# SuperDev model setup

Write `.agents/superdev-models.md`, the shared role-to-model map that SuperDev skills read. Missing files and missing roles fall back to the active harness's available models, so this file supplies overrides rather than required configuration.

## Detect available models

Enumerate the model identifiers and supported reasoning efforts accepted by the active harness's delegation interface. Determine whether effort is part of the identifier or a separate parameter. Prefer a harness-provided models API or CLI. If none can be detected, ask the user for the identifiers they can use.

Never write an unconfirmed identifier. The aliases `inherit-parent` and `auto` select the parent chat model; use them only when its reasoning effort is high and its standard, non-fast variant is active.

## Load current choices

If `.agents/superdev-models.md` exists, read its budget line and role values as the current choices. Otherwise use the defaults shown below. During this step, drop and report any role line that is not in the current role list below; it belongs to a retired role.

Keep existing model families and panel lists, but normalize every real role entry to that family's detected high-effort, standard-speed variant. Do not carry forward other effort levels or speed variants. If a model lacks a detected high-effort, standard-speed variant, flag the role and ask the user to choose a supported model. Preserve `inherit-parent` or `auto` only when the parent is already using high effort with standard speed. Drop retired roles and report them. Never copy model names from another harness or an older setup guide without checking them.

## Apply the reasoning setting

Use high reasoning for every model and role. Use the standard, non-fast model variant. This setting is fixed; do not ask the user to choose a different reasoning budget or speed tier.

Build the working map from the defaults on every run. Preserve custom model families, panel lists and their order. For each real model entry, including every panel entry, choose the exact detected high-effort, standard-speed identifier. If the harness takes effort separately, keep its detected model identifier and add `[reasoning_effort=high]`. If no such combination is supported, mark the role as needing a different model; never fall back to another effort or speed tier. Preserve an alias only when the parent model is already high effort and standard speed.

When effort is part of the identifier, use the detected high-effort variant without a fast suffix. When effort is separate, pass `reasoning_effort=high` and leave fast mode disabled. If effort cannot be controlled or fast mode cannot be disabled, mark that model unsupported and ask for a replacement instead of claiming it meets the policy.

## Confirm the map

Show the fixed high-effort, standard-speed setting, every role with its resulting model, and each retired role dropped while loading current choices. Mark any unsupported identifier or role. Ask whether to keep the map or choose a different supported model for flagged roles. Do not offer other effort levels or speed tiers.

Panel roles use one subagent per list entry, so list length controls the panel size. This applies to `arena runners`, `architect runners`, and `interrogate reviewers`. `arena cross-judge pool` is also a list, but Arena chooses one model from a family different from the parent's when possible. `swarm workers` supplies the default worker model unless a race assigns a model to each arm.

## Validate and write

Every real model identifier must appear in the detected set, and each separate high-effort annotation must be supported for that model. Validate the identifier without its annotation. Confirm that every role uses high effort and standard speed. Stop and ask for a replacement if any role cannot meet both conditions.

Overwrite `.agents/superdev-models.md` so reruns converge on one complete map. Record `high (standard speed)` as the budget. Use one line per role with these labels and defaults:

```text
# SuperDev model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` uses the parent only when it already runs high reasoning at standard speed. Alias entries in a panel list still count toward its fan-out.
# budget: high (standard speed for all models)
# An entry's [reasoning_effort=...] annotation is passed separately from its model identifier.
feature, refactoring, bug-fix, perf-issue, hillclimb: grok-4.7-high
judgment and prose: claude-opus-5-5-high
hardest tasks: claude-opus-5-5-high
how explorer: grok-4.7-high
how explainer: claude-opus-5-5-high
why investigators: grok-4.7-high
why synthesizer: claude-opus-5-5-high
reflect tooling: gpt-5.6-sol-high
reflect judgment, divergent, synthesizer: claude-opus-5-5-high
arena runners: claude-opus-5-5-high, gpt-5.6-sol-high, grok-4.7-high
arena cross-judge pool: claude-opus-5-5-high, gpt-5.6-sol-high, grok-4.7-high
swarm workers: grok-4.7-high
architect runners: claude-opus-5-5-high, gpt-5.6-sol-high, grok-4.7-high
interrogate reviewers: claude-opus-5-5-high, gpt-5.6-sol-high, grok-4.7-high
```

Tell the user the model map was written and that rerunning `$superdev-setup` can update it.

Check whether the project has a `verify-*` skill under `.agents/skills` or another way to drive the real app. If it has none, offer once to create a project-local verification skill with `/create-verification-skill`. If the user accepts, read and follow `.agents/skills/create-verification-skill/SKILL.md`.

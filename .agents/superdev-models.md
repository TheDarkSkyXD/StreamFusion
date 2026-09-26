# SuperDev model configuration. One line per role.
# budget: medium (target reasoning_effort=high)
# User ceiling: never use reasoning above high, including for missing roles or fallback models.
# An entry's [reasoning_effort=...] annotation is passed separately from its model identifier.
# Panel entries each count toward fan-out. Preserve their order when selecting runners.
feature, refactoring: gpt-6-sol [reasoning_effort=high]
bug-fix: gpt-6-sol [reasoning_effort=high]
perf-issue: gpt-6-sol [reasoning_effort=high]
hillclimb: gpt-6-sol [reasoning_effort=high]
judgment and prose: gpt-6-astra [reasoning_effort=high]
hardest tasks: gpt-6-astra [reasoning_effort=high]
how explorer: gpt-6-sol [reasoning_effort=high]
how explainer: gpt-6-astra [reasoning_effort=high]
how critics: gpt-6-astra [reasoning_effort=high], gpt-5.6-sol [reasoning_effort=high], gpt-6-sol [reasoning_effort=high], gpt-6-luna [reasoning_effort=high]
why investigators: gpt-6-sol [reasoning_effort=high]
why synthesizer: gpt-6-astra [reasoning_effort=high]
reflect tooling: gpt-6-sol [reasoning_effort=high]
reflect judgment, divergent, synthesizer: gpt-6-astra [reasoning_effort=high]
arena runners: gpt-6-astra [reasoning_effort=high], gpt-5.6-sol [reasoning_effort=high], gpt-6-sol [reasoning_effort=high], gpt-6-luna [reasoning_effort=high]
arena cross-judge pool: gpt-6-astra [reasoning_effort=high], gpt-5.6-sol [reasoning_effort=high], gpt-6-sol [reasoning_effort=high], gpt-6-luna [reasoning_effort=high]
swarm workers: gpt-6-sol [reasoning_effort=high]
architect runners: gpt-6-astra [reasoning_effort=high], gpt-5.6-sol [reasoning_effort=high], gpt-6-sol [reasoning_effort=high], gpt-6-luna [reasoning_effort=high]
interrogate reviewers: gpt-6-astra [reasoning_effort=high], gpt-5.6-sol [reasoning_effort=high], gpt-6-sol [reasoning_effort=high], gpt-6-luna [reasoning_effort=high]

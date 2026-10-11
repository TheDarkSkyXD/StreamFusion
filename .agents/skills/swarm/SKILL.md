---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
---

# Swarm

Fan out N parallel cloud workers. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is total workers, not the cloud concurrency limit.
4. Pick the worker model from the `swarm workers` line in `.agents/superdev-models.md`. If the map or that line is missing, use `grok-4.7-high`. Use only high-reasoning, standard-speed variants. For `auto` or `inherit-parent`, omit `model` only when the parent runs high reasoning at standard speed. If the delegation interface rejects a configured slug, use the default and say so. If it rejects the default, use a detected high, standard-speed slug; if none is available, report that the worker cannot run under the configured policy. For a model race, name each arm's model up front.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, name the exact SHAs in the brief. For a measurement, also name the method, including sample count, what one sample is, and the order. The worker records the SHAs and method in its result.

## Phase B: Fan out

Spawn all N general-purpose workers together through the active harness's delegation interface, using isolated or remote environments and background execution when supported. Use a local worker only when it needs something on the user's computer. Apply the Step 4 model, leaving it unset for `auto` or `inherit-parent`.

When a worker must start from a non-default pushed branch, use the active harness's base-branch setting or name the branch explicitly in the brief.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that proves a defect reports `ISSUES` and lists each issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that omits the SHAs or method required by its brief, and respawn that worker once. After a second miss, record a gap. A gap is not a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.

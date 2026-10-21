---
name: orchestrate-omp
description: "Coordinate OMP subagents on substantial work. Use when parallel discovery, specialist review, or clearly partitioned implementation will shorten or strengthen the result; skip trivial tasks."
---

# Orchestrate on OMP

Stay available to the user while substantive work runs behind the scenes. The root coordinator owns the plan, user interaction, approvals, scope, integration, and final verification. The [portable runtime contract](../pstack-pi/references/runtime.md) and the [OMP binding](../pstack-pi/references/omp.md) hold the facts this skill relies on: model routing, workspace roots, model provenance, and the task lifecycle.

## 1. Frame

1. State the done predicate and the final artifact or decision.
2. Split only independent discovery, specialist review, or implementation with clear ownership. Keep tightly coupled work in one session.
3. Assign distinct primary ownership and name shared contracts before dispatch. Do not duplicate investigations or serialize a useful batch merely to avoid possible file overlap.
4. Keep external side effects and approval decisions with the root.

## 2. Choose Agents

Use the exact names exposed by the live `task` tool; its inventory is authoritative. For the current OMP roster:

| Work | Agent | Effort when exposed |
|---|---|---|
| Narrow read-only codebase discovery | `scout` | `lo` |
| Routine scoped implementation | Omit `agent` for the default worker | `med` |
| Difficult or ambiguous implementation | Omit `agent` for the default worker | `hi` |
| Mechanical edits or data collection | `sonic` | `lo` |
| UI/UX implementation or review | `designer` | `med` or `hi` |
| Code-quality verdict | `reviewer` | `med` or `hi` |
| Security verdict | `security-reviewer` | `hi` |
| External library or API research | `librarian` | `lo` or `med` |

When the live task schema exposes `effort`, match it to the assignment: `lo` for narrow questions, `med` for routine work, and `hi` when ambiguity or consequence justifies it. Otherwise rely on the selected agent's configured model role; do not pass an unavailable field.

An agent's model comes from `task.agentModelOverrides` or its definition. A task item cannot choose one, and the `model` field the schema may list belongs to `seance`. Roles that share an agent share its model, so a panel on one agent runs one model.

Honor read-only and blocking markers in the live inventory. Never pass the default worker's name explicitly.

## 3. Dispatch

1. When the live schema exposes `tasks[]`, put independent participants in one batch so they start together and structure shared `context` as `Goal`, `Constraints`, and `Contract`. Otherwise start one participant per task call without passing `context`.
2. Give every item a stable CamelCase `name` of at most 32 characters, the most specific specialist `agent` when one fits, a complete standalone `task`, and a `solutionSpace`. Omit `agent` only for the default worker. Add `effort` only when the live schema exposes it. `solutionSpace` says how open the problem is, for example `one fix: rename, names given` or `cause open, no repro`. It never says how large the work is.
3. Structure each assignment as `Target`, `Change`, and `Acceptance`. Include essential repository state, decisions, restrictions, and dependencies because children start without conversation history.
4. Give every writer an exact writable scope. A manual worktree does not move a Task's working directory, so a worktree path in the brief does not isolate a writer. When the live schema exposes `isolated`, use `isolated: true` for concurrent writers that need separate workspaces. Otherwise keep write sets provably disjoint, or run the writers one after another. Isolation is not a sandbox. Capture the parent baseline before dispatch. When changes must wait for review, the user sets `task.isolation.apply: false` in OMP settings, because it is not a task field. Then inspect the returned metadata to learn whether changes were applied or retained as artifacts.
5. Tell ordinary workers: `Complete this assignment directly. Do not call task or spawn subagents.` Allow nested delegation only when the assignment explicitly makes that worker a coordinator.
6. Tell workers to skip project-wide formatting, linting, and test suites. The root runs shared validation once after integration.

Large context belongs in a local file referenced with `local://<path>`, not duplicated across assignments.

Use `outputSchema` only when the live schema lists it and the coordinator needs a machine-readable result. Set `schemaMode: "strict"` when invalid output must fail rather than return with a warning.

## 4. Coordinate

- Results auto-deliver. Continue handling user messages and independent root work instead of polling continuously.
- Siblings may exchange concise dependency updates through OMP IRC. Name expected dependencies in shared context so communication is purposeful rather than discovery by negotiation.
- Call `wait` only when blocked, read `proc://` to inspect jobs, send a bounded correction with `write agent://<id>`, and cancel stale work with `write proc://<id>/kill`. Agent Hub is a TUI for the user, and no model-facing hub exists. The OMP binding's Task lifecycle says what each control does to a child.
- Read complete results from `agent://<id>`. Use `history://<id>` when a report is incomplete or suspicious, and after any follow-up message, because `agent://<id>` may not show the follow-up.
- A completed job means the child yielded successfully. It does not mean its artifact is accepted.
- Before replacing a stalled or failed child, settle who owns its workspace and changes (see Workspace roots in the OMP binding).

## 5. Integrate

1. Drain every required participant or record the cancellation or gap.
2. Inspect each claimed artifact and reconcile conflicts against the declared ownership and contracts.
3. Run the affected validation and real user path from the root at the integrated head.
4. Return one concise result with agent identifiers, accepted findings or changes, verification evidence, and unresolved gaps.

Claim model or backend diversity only when each child's journal proves it, as [Child model provenance](../pstack-pi/references/omp.md#child-model-provenance) describes.

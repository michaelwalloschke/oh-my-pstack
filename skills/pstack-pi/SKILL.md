---
name: pstack-pi
description: "Pi and Oh My Pi runtime adapter for poteto-mode. Maps canonical pstack roles and lifecycle protocols to the live host's agents, model routing, batching, isolation, and result resources."
---

# pstack on Pi and Oh My Pi

Read the [portable runtime contract](references/runtime.md) before delegation, and on OMP the [OMP binding](references/omp.md) too. Together they hold the rules for host identity, model routing, reasoning, model provenance, workspace roots, and the task lifecycle.

`poteto-mode` is the sole router. It selects the playbook, canonical role, step order, and lifecycle protocol. This adapter translates those choices. It does not change a playbook gate. The live host's instructions, agent inventory, and tool schema remain authoritative.

## Canonical role map

Map a role's behavior to an available agent, not its label to an invented agent name.

| Canonical role | OMP mapping | Contract |
|---|---|---|
| `explorer` | `scout` | Read-only repository reconnaissance and trace reduction. |
| `watcher` | `scout` | Observe one exact state transition, then terminate. |
| `planner` | `designer` when available, otherwise `task` with a technical-planning brief | Architecture, decomposition, and sequencing. |
| `designer` | `designer` when available, otherwise `task` with a design brief | Product, interaction, or alternative design candidates. |
| `reviewer` | `reviewer` | Independent code, protocol, or behavioral review. |
| `researcher` | `librarian` when available, otherwise an available read-only research facility | Source-verified external documentation and API research. |
| `synthesizer` | `reviewer` | Adjudicate frozen evidence without changing it. |
| `implementer` | `task` | Bounded implementation with explicit write ownership. |
| `owner` | `task` | Own one PR lifecycle; the role can outlive an individual session. |
| `mechanical` | `sonic` | Fully specified low-judgment edits. |

Use `security-reviewer` for an independent security lane when it is available. A later synthesizer does not replace that review. OMP routes models by agent name, so roles mapped to one agent share its model (see [Model routing](references/omp.md#model-routing)).

Canonical roles and model aliases are not concrete agent names. For the general-purpose default, omit `agent` when the live schema requires omission. `poteto-agent` and `comment-sicko` are direct named compatibility seams only when the host exposes them; they are not the default canonical routing. Never invent a `role` field. When `designer` or `librarian` is unavailable, map `planner` to `task` with a technical-planning brief and `researcher` to an available read-only research facility, typically `scout`.

The imported warning about a planning subagent concerns a source-host mechanism that bypasses the skill contract. Technical planning through a supported agent with a standalone brief is valid. Native Pi still needs an actual child-delegation facility; a model list does not supply one.

## Task contract

The root performs every child start. Children do not start children or ask the user directly. Put these restrictions in each brief.

Children start without the parent conversation. Give each one its goal, canonical role and mapped agent, writable and forbidden paths, repository and base revision, frozen evidence pointers, acceptance criteria, verification responsibility, output paths, report format, the active standing policy, and a `solutionSpace` that says how open the problem is (see [Reasoning controls](references/omp.md#reasoning-controls)).

Use the actual tool schema. Current OMP exposes a `tasks[]` batch with a required shared `context` unless `task.batch` is off, which leaves one flat item per call. Pass only fields the current schema supports, and never put a worker `model` in an item. When batch mode is exposed, put shared immutable context in `context` and each independent slice in a separate item with a unique name and its own `agent`. Start independent participants together within the host's concurrency limit. Preserve required lane coverage across waves when the limit is smaller than the panel.

Separate writers through `isolated: true` when the live schema lists it, or through write sets you can prove disjoint. A manual worktree does not bind a Task's working directory, so a path in the brief does not redirect a writer. Isolation separates roots and is not a sandbox. Capture the parent baseline and settle ownership as [Workspace roots](references/omp.md#workspace-roots) says. Freeze candidates before review and reviewer reports before synthesis.

## Results and follow-ups

Record the returned agent and job identifiers. Consume asynchronous results when delivered; a preview or compact result may be truncated. Always read the full result and transcript through the resources the host actually exposes, typically `agent://<id>` and `history://<id>`. Never treat a compact preview as the child's full report.
On OMP, an early `agent://<id>` read may show only running progress. After completion, read the published result before sending a next-phase follow-up; the earlier progress read does not consume the final report.

Use the live messaging, cancellation, and wait facilities. On OMP, `write agent://<id>` messages a child over its IRC transport, `write proc://<id>/kill` cancels, and `wait` blocks. Agent Hub is a TUI for people, not a model-facing tool, so do not invent a `hub` operation. Other hosts expose their own controls. Keep working while independent work remains. For a finite native `bash`, `eval`, or `task` job started asynchronously, yield the turn so the host can deliver the result. Do not poll, sleep, or call wait merely to hold the turn until that job ends. Consume the native delivery on the follow-up wake. Wait only when blocked, which includes owing a reply to a direct message you sent, and the host has no delivery that will resume the session. Ignore duplicate terminal deliveries and reject stale generations. [Task lifecycle](references/omp.md#task-lifecycle) says what each control does to a child.

Use fresh sessions by default for new work, fix rounds, retries, and the next queue item. Supply the original brief, later directives, prior report, and branch as needed. Retain or resume a session only when the work needs costly live state it still owns, such as uncommitted changes, its checkout, a running server, simulator, or watcher. On OMP a finished child stays idle and a message can revive it, so check `read proc://` and `history://<id>` before resuming or replacing one. A stop order to a running agent is not session reuse.

A child report is evidence, not verification. The root inspects the artifact and runs the checks assigned to it. Report checks as unrun when they were deferred to the parent. Never steer a reviewer toward a preferred conclusion.

## Canonical protocols

### Bounded session

1. Write a standalone brief for one unit and role.
2. Start the mapped available agent and record its scope, base revision, and output generation.
3. Consume its full result and inspect the artifact.
4. Use an in-scope correction only when preserving necessary live state; otherwise start a fresh session with consolidated context.
5. Independently verify the unit before accepting it.

A role or unit change requires a fresh session.

### Panel

1. Partition independent slices or race arms with one participant per assignment.
2. Start the panel within the live concurrency limit, using one batch where supported.
3. Track participants by name and identifiers, not arrival order.
4. Obtain every required result or report the missing lane. Do not represent unavailable coverage as complete.
5. Freeze artifacts and exact generations, then start independent reviewers in fresh sessions.
6. Freeze verdicts before a separate synthesis session when needed.
7. The root selects, integrates, and verifies. Judges advise.

### Long-lived owner

The owner role persists through a PR lifecycle; this does not require one permanent agent session.

1. Assign one owner role to one branch and writable slice.
2. Start a fresh session for each returned round unless costly live state requires retention.
3. Give each round the complete brief, branch, prior report, accepted findings, and authorization.
4. Owners may execute their assigned CLI watch/fix loop. The root starts independent watchers and verifiers; owners do not spawn children.
5. Require the exact head and evidence at every verification boundary. Independently verify before authorizing the next round or merge.
6. Stand down immediately on an operator hold, stale generation, scope breach, or ownership violation.

### One-shot watcher

1. Start a read-only available watcher with the exact branch, head, generation, watched predicate, and stop predicate.
2. Require one meaningful event and a terminal report.
3. Reject a report whose generation no longer matches.
4. Start a fresh watcher for each new generation; cancel superseded work through the exposed host facility.

A watcher observes. It does not fix, merge, authorize, or silently follow a changed head.

## Interactions and ownership

Children resolve uncertainty from source, standing policy, frozen evidence, or the brief. Otherwise they report the safest reversible assumption or the exact unavailable prerequisite. The root resolves child questions and owns user interaction.

One writer owns each mutable output. A new commit, restack, resolution, or applied patch invalidates verdicts for the old generation. The root owns external writes, merges, deletion, and final verification. Judges and synthesizers advise.

## Model routing

Agent and model selection are separate. On OMP the agent picks the model through `task.agentModelOverrides`, the agent definition, or `modelRoles`, and a task item never carries a worker `model`. Follow [Model routing](references/omp.md#model-routing) and [Reasoning controls](references/omp.md#reasoning-controls). Do not edit user settings merely to compensate for a stale skill example.

Use only selectors and reasoning controls confirmed by the live inventory and tool schema. `inherit-parent` and `auto` mean to omit an explicit model choice when the host supports that behavior. Honor the host's explicit rejection and fallback policy; report an unavailable requested choice instead of silently substituting a guessed model. Before dispatching a child whose model comes from a `.pstack/config.md` line, compare that line with the mapped agent's effective override and report any mismatch, as [Check before dispatch](references/omp.md#model-routing) says. Never send a hidden `effort` field when `task.enableEffort` is false or the live schema omits it. Read a child's model from its journal, as [Child model provenance](references/omp.md#child-model-provenance) describes, and claim model independence only when those journals demonstrate it.

## Writing

Apply `unslop` to replies, briefs, reports, reviews, commits, and agent-facing edits. Use the installed `writing-for-agents` guidance for skill changes.

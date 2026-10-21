# Portable pstack runtime contract

This file is the host-neutral binding for the imported pstack skills. Read it before
using any instruction that mentions a task runner, model, transcript, question tool,
skill path, or long-running loop. When the host is OMP, also read the
[OMP binding](omp.md). It holds model routing, provenance, workspace roots, and the task
lifecycle for that host.

## Host identity

Use the capabilities exposed by the current agent host. Do not assume a particular
host, CLI, or model vendor.

Identify the host from the active runtime, not from programs installed on the machine.
A CLI on `PATH` shows that a program exists, not which agent runs this session. These
signals identify a host:

- The host's own statement of its identity in the system prompt or session metadata.
- The live tool schema. OMP exposes a `task` tool whose items take `task` and
  `solutionSpace`, and its read tool resolves `skill://`, `agent://`, `history://`, and
  `proc://`.
- The way the user invoked the skill, such as `/skill:<name>` on Pi and OMP or
  `$<name>` on Codex.

Do not infer identity from undocumented environment variables. When no signal
identifies the host, report it as unknown and rely only on capabilities that the live
tools confirm. After the runtime identifies the host, that host's own CLI is a valid
inventory source, for example `omp models --json` on OMP.

When a capability is unavailable, preserve the workflow gate and use the nearest
truthful local equivalent. Do not claim a child, review, transcript, or live check
happened unless the host reported it.

## Canonical roles

| pstack role | Required behavior |
| --- | --- |
| `explorer` | Read-only repository reconnaissance and trace reduction. |
| `watcher` | Observe one exact state transition, then terminate. |
| `planner` | Technical architecture, decomposition, and sequencing. |
| `designer` | Product, interaction, or alternative design candidates. |
| `reviewer` | Independent code, protocol, behavioral, or security review. |
| `researcher` | Source-verified external documentation and API research. |
| `synthesizer` | Adjudicate frozen reports without changing their evidence. |
| `implementer` | Bounded implementation or test changes with explicit ownership. |
| `owner` | Own one PR lifecycle. The role can outlive an individual session. |
| `mechanical` | Fully specified low-judgment edits. |

Map these roles to the live host's agent or task names. OMP's recommended mapping is
`scout`, `designer` when available, `reviewer`, `security-reviewer`, `librarian` when
available, `task`, and `sonic`, and `skill://pstack-pi` holds the exact table.
Unavailable names map to a supported `task` or `scout` brief. Claude Code and Codex may
expose different names. The live inventory wins.

Every child brief must stand alone. It must name its goal, role, writable scope,
acceptance criteria, verification command, forbidden scope, and report format. On OMP it
also carries a `solutionSpace` (see [Reasoning controls](omp.md#reasoning-controls)). A
child does not spawn another child unless the host explicitly supports nested delegation
and the active playbook requires it.

Use a fresh session by default for new work, a fix round, a retry, and the next queue
item. Retain or resume a session only when the work needs costly live state it still
owns, such as uncommitted changes, its checkout, a running server, simulator, or
watcher. Whether a finished child can resume depends on the host. On OMP, read
[Task lifecycle](omp.md#task-lifecycle).

## Models and routing

A model inventory lists the models the current conversation can use. It does not show
that a child can use them. Routing is the mechanism that sends one child to one model,
and each host has its own. Native Pi shows the gap. `pi --list-models` and `/model`
select the single active conversation model, and Pi has no built-in subagents.

| Host | How a child gets its model | Where the setting lives |
| --- | --- | --- |
| OMP | By agent name. `task.agentModelOverrides.<agent>` comes first, then the agent definition's `model`, then the session fallback. A task item never carries a worker model. See [Model routing](omp.md#model-routing). | The project's `.omp/config.yml`, or the user's `config.yml` under `~/.omp/agent/` |
| Pi with `pi-subagents` | `subagents.agentOverrides.<agent>.model` | `.pi/settings.json` |
| OpenCode | The agent's `model` setting | `opencode.json` or `opencode.jsonc` |
| Another host | A per-item `model` field or another mechanism, only when the live tool schema or host documentation offers it for ordinary children | The host's own configuration |

For native Pi, install the maintained `pi-subagents` package when per-role models or
parallel children are required:

```bash
pi install npm:pi-subagents
```

Restart Pi and run `/subagents-doctor`. Once the `subagent` tool is visible,
configure its `subagents.agentOverrides` in `.pi/settings.json`. The package's
built-in agents map to pstack roles as follows: `scout` for `explorer` and
`watcher`, `researcher` for `researcher`, `worker` for `implementer` and
`mechanical`, `reviewer` for `reviewer`, `oracle` for planning and synthesis, and
`delegate` for an `owner`.

Use concrete `provider/model-id` values only when the host exposes per-child model
selection and the value was confirmed in the live inventory. A per-item `model`
field is usable only when the selected ordinary agent supports it; field presence
in a shared task schema is insufficient. Otherwise use supported agent settings or
frontmatter. Use role aliases only when the host documents a role-to-model mapping.
`inherit-parent` means the current conversation's model only when the host can pass
it to a child. A missing role entry means the host default. A panel is a list of role
or model choices, and its size controls fan-out, but each seat needs an agent whose
resolved model can be checked. Honor the host's explicit rejection and fallback
policy. Report an unavailable requested choice instead of silently substituting a
guessed model. A role's configured choice and the host's effective routing can
disagree, for example after a hand edit or when a routing file is missing. Compare
them before dispatch and report a mismatch. Do not ignore the configured line
silently, and do not edit user or global settings to make them agree.

OMP and `pi-subagents` route by agent name, so every role that runs through one agent
runs on one model. A panel whose seats run through one agent has N participants on one
model. Report it that way. When the user wants independent models, give the seats
distinct agents that the live roster already lists, or report that the shared agent
cannot express both choices. Claim independence only from the host's resolved-model
evidence. On OMP, the `model` field that a live task schema may list belongs to
`seance` consults, which require `sourceSession`, and never routes a worker
([OMP 18.12.5 agent discovery](https://github.com/can1357/oh-my-pi/blob/v18.12.5/docs/task-agent-discovery.md)).
The resolved-model evidence is the
child's journal, as [Child model provenance](omp.md#child-model-provenance) describes.

When the host has models but no child delegation, do not write a role mapping that
looks active. Report the capability gap and tell the user to switch Pi's single
active model with `/model` or `pi --model provider/model-id`. Workflow skills still
run on that active model, but panel and child-agent behavior is unavailable unless
the user installs a host extension or uses a different runtime that provides it.

The optional configuration path is `$PSTACK_CONFIG`. If it is unset, use
`.pstack/config.md` in the current project for project-local settings. Do not write
to a vendor-specific home directory unless the host explicitly asks for it.

### Reasoning budgets

Setup may record a `# budget: <label> (<target>)` comment and optional
`<workflow role> reasoning: <effort>` entries alongside model choices. The budget
comment records the user's preference. The per-role entries specify what to pass
to the host. `unlimited` keeps current efforts. `large`, `medium`, and `small`
target xhigh, high, and medium, respectively. A budget is not a spending limit.

Read the reasoning entry for the selected workflow role when delegating. For a
panel, pair efforts with model entries in order and require equal list lengths.
`host-default` means omit the reasoning override. For grouped roles such as
`feature, refactoring`, apply the matching grouped reasoning entry to both roles.
For a judge chosen from a pool, use the effort at that candidate's position.

Pass an explicit effort only when the live child facility and selected model
support it. If the host encodes effort in model IDs, use only detected variants
with a documented mapping. Never construct an ID by changing a suffix. Keep
supported aliases, including `inherit-parent`, unchanged. If an explicit effort
is unsupported or a panel's lengths differ, report the invalid configuration
before spawning. Do not silently claim the requested budget was applied. Roles that
share an agent share its reasoning level, so when they ask for different efforts, ask
the user for one value instead of averaging or choosing silently. On OMP, the controls
are in [Reasoning controls](omp.md#reasoning-controls). With `task.enableEffort: false`,
omit `effort` entirely and keep a supported thinking level on the agent's routed
selector.

Hosts without reasoning controls retain their model choices. Setup must report
that limitation and omit applied budget and reasoning entries. A model inventory
alone does not establish support for reasoning controls.

## Questions and interaction

Use the host's structured user-interaction tool when it exists. Otherwise ask one
focused question in the normal conversation. Never invent a vendor-specific question
tool name.
An observable fact belongs to a probe or verification run, not a user question.

## Skills and paths

Invoke skills by their host-supported skill name, normally `/skill:<name>` or `$name`.
Within this package, sibling files are under `skills/<name>/`. Do not use a
vendor-specific plugin path or assume a global installation path.

OpenCode's native Agent Skills loader looks in `.opencode/skills/` for a project or
`~/.config/opencode/skills/` globally. When installing this repository for
OpenCode, copy the contents of this package's `skills/` directory into one of
those locations. OpenCode loads a skill on demand through its native `skill`
tool; it does not automatically scan an arbitrary cloned repository directory.
OpenCode's built-in primary and subagents are the delegation surface. Use the
host's `opencode.json` or `opencode.jsonc` model configuration and live agent
inventory rather than assuming Pi's `pi-subagents` settings apply.

## Transcripts and history

Transcript-dependent skills accept an explicit transcript directory or host history
resource. Prefer `$PSTACK_TRANSCRIPTS_DIR` when the host does not expose a history
resource. Never scan another project or a global vendor transcript tree. If no
transcript source is available, report the gap and continue only with evidence that
does not require it. On OMP, `history://<id>` is the history resource. A child's own
journal is reachable only through the session that started it, using `PI_SESSION_FILE`
and the child's agent id, as [Child model provenance](omp.md#child-model-provenance)
describes.

## Long-running work and verification

Use the host's durable goal, watcher, or loop facility only when that capability
is actually exposed. An hourly audit may be `/loop 1h` on hosts that expose it.
Do not invent a portable scheduler, timed heartbeat, or unattended hourly
continuation. If no scheduler exists, keep the predicate and the next exact
command in a project-local checkpoint and stop. For a finite native
asynchronous job, yield so the host can deliver; do not poll or wait the
turn to completion. Re-arm an existing native watcher after every
state-changing wave. Post a status message only for previously unreported
changes.

The root coordinator owns user interaction, approvals, integration, and final
verification. A worker report is evidence, not proof. The root must inspect artifacts
and run the promised checks on the integrated result.

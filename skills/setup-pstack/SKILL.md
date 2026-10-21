---
name: setup-pstack
description: Configure which host-supported roles, models, and reasoning budgets pstack uses per workflow role. Detects the live host inventory, writes portable project-local configuration, and on OMP saves per-agent model routing in the project. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's role choices.
---

# Setup pstack

Follow the [portable runtime contract](../pstack-pi/references/runtime.md) throughout this setup, and on OMP the [OMP binding](../pstack-pi/references/omp.md) too.

Write the optional pstack configuration at `$PSTACK_CONFIG` when that variable is set; otherwise use `.pstack/config.md` in the current project. This is an override layer, not a requirement. Never write to a vendor-specific home directory.

## Steps

Host identity, model discovery, and model assignment are three separate capabilities. Identify the host from the active runtime, as the contract's [Host identity](../pstack-pi/references/runtime.md#host-identity) rule says. Never decide it by checking whether `pi`, `omp`, `opencode`, or `codex` is on `PATH`, and never read a missing CLI as a statement about the host. Run the identified host's own inventory commands and no other host's.

A model that a host lists is available to the current runtime, but that does not mean a workflow can send work to it. Per-child assignment needs a routing mechanism. That is either a model field on each task item that the host documents, or a setting that selects a model by child agent name. Do not require a task-item `model` field when the host documents another mechanism, and do not claim that a role was assigned when no routing mechanism exists. Native Pi intentionally does not include subagents.

### Pi delegation prerequisite

For native Pi, recommend the maintained `pi-subagents` package when the user wants
parallel workers or per-role models:

```bash
pi install npm:pi-subagents
```

Tell the user to restart Pi after installation, then run `/subagents-doctor`.
Continue setup only when the `subagent` tool and the expected agents are visible.
The package supplies the delegation facility; it does not choose pstack's model
policy by itself.

### OpenCode delegation prerequisite

OpenCode has its own native primary and subagent agents. Do not install
`pi-subagents` or write Pi-specific settings when the current host is OpenCode.
Use the agents and concrete `provider/model-id` choices reported by OpenCode, and
keep their model configuration in the host's `opencode.json` or
`opencode.jsonc`. If OpenCode does not expose a usable subagent, report that
limitation instead of substituting a Pi-specific mechanism.

### OMP delegation prerequisite

OMP has native `task` agents and routes each child's model by agent name through `task.agentModelOverrides`. A task item never carries a worker model. The `model` field the live schema may list belongs to `seance` consults, which need a `sourceSession`, so never use `seance` for workers or pass `model` to an ordinary agent ([OMP 18.12.5 agent discovery](https://github.com/can1357/oh-my-pi/blob/v18.12.5/docs/task-agent-discovery.md)). Do not install `pi-subagents`, write `.pi/settings.json`, or edit the user's `config.yml` under `~/.omp/agent/`. Setup writes only the project's `.omp/config.yml` and `.pstack/config.md`, and never creates agent definitions. OMP's settings commands do not write arbitrary project keys, so edit the project file directly. When `task.enableEffort` is false, omit `effort` and carry a supported thinking level on the agent's routed selector, as [Reasoning controls](../pstack-pi/references/omp.md#reasoning-controls) says.

### 1. Detect available choices

Detect these capabilities independently:

1. The model IDs the current host actually exposes.
2. Whether the host has a task or subagent facility and a routing mechanism that can
   send a child to a chosen model, and how the selected ordinary agent receives that choice.
3. Whether that mechanism accepts a separate reasoning effort or exposes model variants
   with documented effort levels. Record only the supported values and mappings.
4. The live agent names, and the mapping from canonical pstack roles to them.

For Pi, `pi --list-models` is the model inventory and the `provider/model-id` form
is the concrete value to record. With `pi-subagents` installed, the `subagent`
tool and `/subagents-doctor` establish the delegation inventory. The live host
inventory is authoritative. Never copy a vendor slug from prose or guess that a
model is available.

For OMP, run these two commands from the project root:

```bash
omp models --json
omp config list --json
```

`omp models --json` returns `{ "models": [...] }`. Each entry has `selector` (`provider/id`), `reasoning`, and `thinking`, which is the list of levels the model accepts or `null`. The list can run to hundreds of entries, so filter it with `jq` or `omp models find <text>` instead of printing it whole, and offer the user only candidates that fit each agent. Only a listed selector is a valid choice. `omp config list --json` returns an object keyed by setting path, and each entry has `value`, `type`, and `description`. Read these keys:

- `task.agentModelOverrides` is the routing map. Its presence proves routing exists even when its value is `{}`.
- `task.enableEffort` and `task.maxEffort`, which govern a per-item `effort`.
- `task.prewalk`, `task.agentPrewalk`, `task.isolation.enabled`, and `modelRoles`, which matter during validation.

The command reads saved global and project settings. It cannot see this session's runtime overrides or `--config` overlays, so treat the result as saved configuration and not as proof of what this session runs. Take live agent names from the `task` tool's roster, because `omp agents` cannot list them. If either command fails, report the exact command and error, and stop model mapping. Do not conclude that OMP lacks routing because a task item has no `model` field or because the override map is empty.

If the host has a task facility but cannot enumerate models, use only a host role
mapping that the facility documents. Do not ask the user to invent a raw slug.
`inherit-parent` is valid only when the host can pass the current model to a child.

Treat a per-item `model` field as usable only when the selected ordinary agent supports it; a field in a shared schema is not evidence. A host whose live schema documents it for ordinary children can assign a model per child that way. OMP's `model` field is not that field, so on OMP use `task.agentModelOverrides` (see [Model routing](../pstack-pi/references/omp.md#model-routing)). Do not dispatch a hidden `effort` field when `task.enableEffort` is false. Treat a choice as configured only after the read-back in step 5, and as having run only when the child's journal shows it ([Child model provenance](../pstack-pi/references/omp.md#child-model-provenance)).

### 2. Load current state

Read the selected configuration path when it exists and treat its concrete values
as current choices. Read its `# budget` line and any per-role reasoning entries too.
Preserve explicit model families, panel lists, and supported aliases on reruns.
If it contains only portable role aliases from a host without
per-child delegation, treat those aliases as stale inactive state and start from
the detected models instead of carrying them into Pi's agent overrides.
A line whose role is not in the current role table, such as `how critics`, is a
retired role. Drop it.

On OMP, also read the project's `.omp/config.yml` when it exists, and run `omp config get task.agentModelOverrides --json` for the saved map. Treat each existing entry as a current choice, and keep entries for agents that are not pstack role targets.

### 3. Budget, map, and confirm

Once per-child selection is available, ask for a reasoning budget. Name the current
budget when the configuration records one. Offer these choices through the host's
structured interaction tool when available; the root owns the question:

- `unlimited`. Keep the current reasoning levels, including max where supported.
- `large`. Target xhigh reasoning.
- `medium`. Target high reasoning.
- `small`. Target medium reasoning.

Apply the budget to the current role table, including each panel entry. Preserve
model families, panel membership, and supported aliases. `unlimited` preserves the
current efforts. The other budgets select the highest supported effort at or below
the target on the ladder `max` > `xhigh` > `high` > `medium` > `low`.

Use a separate reasoning argument only when the host's child facility exposes it.
If the host encodes reasoning in model IDs, select only detected IDs whose family
and effort mapping the host documents. Never construct a model ID by changing a
suffix. Leave `inherit-parent` and other documented aliases unchanged.

On OMP the level rides the routed selector, `<provider>/<model>:<level>`, which the host documents as selector syntax and not as a model ID. For each agent's model, take its `thinking` list from `omp models --json` and pick the highest listed level at or below the target. Levels below `low` are never chosen for a budget. Add no level to a model whose `thinking` is `null`. A level in the selector fixes that agent's reasoning, so the `auto` classifier stops deciding for it. Say so when you write one. Keep a level or an `:auto`, `:off`, or `:inherit` suffix that the user already chose and confirmed.

When no supported effort meets a target, mark the role as needing a choice. If
the host exposes no reasoning control, report that limitation and preserve its
model choices. Do not record an applied budget or reasoning override in that case.
A budget is a reasoning preference, not a monetary limit.

On OMP, group the workflow roles by the agent each runs through, using the adapter's role map or a distinct live agent the user assigns to a seat, and show one row per live agent. Each row names the roles and config lines the agent serves, its current override, the proposed model, and the level. Roles that share an agent share one model and one level. Say so, and say that a panel whose seats run through one agent has N participants on one model. Independent seat models need distinct agents that the live roster already lists, such as discovered project agents in `.omp/agents/`. Setup never creates agent definitions. When no distinct live agent exists, report the shared-agent limitation and keep one choice for that agent. When a group's existing lines disagree, show the conflict and ask for one choice for that agent. Never configure `seance`. It consults past sessions and is not a pstack role target.

If both model inventory and native child model routing are available, show every
workflow role with its current concrete `provider/model-id` choice and supported
reasoning level. Distinguish applied efforts from host defaults. Mark an
explicit model absent from the live inventory as needing a replacement. Also list
each line step 2 dropped. Ask the user to accept or change the choices, offering
only detected model IDs and `inherit-parent` when supported. Use the host's
structured interaction tool when available; otherwise the root asks one focused
question in normal conversation.

If the host exposes models but no task or subagent facility, stop model mapping
with an explicit capability report. For native Pi, recommend
`pi install npm:pi-subagents`, a restart, and `/subagents-doctor`. For OpenCode,
explain that its native agents are not visible or configured and point the user
to the host's agent configuration. For OMP, name the failed inventory command or the missing `task.agentModelOverrides` setting without installing Pi packages. For any other host, name the missing
capability without proposing a vendor-specific substitute. Say that no pstack
role can receive a different model in this session and do not present the
portable defaults as an assignment or overwrite an existing role configuration
with inactive aliases.

For panel roles (`arena runners`, `architect runners`, and `interrogate reviewers`), one child runs per entry, so list length controls fan-out. `arena cross-judge pool` is a list of candidates for one judge. Arena selects one entry, preferring a different model family from the parent when returned resolved-model metadata demonstrates it. Prefer diversity for judgment-sensitive panels. `swarm workers` is the default choice for every worker unless a race or comparison assigns a different choice per arm.

### 4. Validate

Every explicit model written must be present in the detected host inventory.
Every reasoning override must be supported by that model and the host's child
facility. Validate each panel entry. Do not treat an unsupported budget as applied.
Role aliases pass only when the host task facility documents those aliases.
`inherit-parent` passes only when the host can pass the current model to a child. If
a selected explicit model is unavailable, or a reasoning value is unsupported,
stop, report both rejected choices, and ask for a replacement. Never
write a configuration that requires another host. Never write a guessed vendor
slug, silently substitute a model, or dispatch a child to work around an invalid
choice. On OMP, write only the project's `.omp/config.yml` and the selected pstack configuration; do not create `.pi/settings.json` or agent definitions, and write no global settings. The pstack configuration records preferences. Call a choice active only when step 5's read-back shows its `task.agentModelOverrides` entry. If the entry cannot be written, report the preference as inactive and the child as running on the agent's own definition or the OMP fallback.

On OMP, also check each of these:

- Each selector, with any trailing thinking suffix removed, equals a `selector` in `omp models --json`. The suffix words are `inherit`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `auto`. OMP also accepts an unambiguous abbreviation of each except `auto`, such as `:med`, but setup writes full names. `max` and `auto` count as a suffix only when the whole string is not itself a catalog `selector`, because IDs such as `glm-4.7:max` exist. Any other colon belongs to the model ID, as in `openrouter/<model>:free`. Look one up with `omp models --json | jq -c --arg s '<provider>/<model>' '.models[] | select(.selector==$s) | {selector, reasoning, thinking}'`.
- A suffix has one of two kinds. A catalog level (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`) must appear in that model's `thinking` list, and none is written for `thinking: null`. A control suffix (`:auto`, `:off`, `:inherit`) is documented selector syntax that the `thinking` list never contains, so do not check it against the list. Write a control suffix only when the user already chose and confirmed it.
- Each `@role` alias exists in `modelRoles`. Leave aliases unchanged.
- Each override key is a live agent name that is a pstack role target. Report and drop any other key you would have written.
- Roles that share an agent carry one model and one level. Report a conflict instead of choosing for the user.
- When `task.prewalk` or `task.agentPrewalk.<agent>` is on, the agent's first edit or write hands off to the `smol` model role. Report that the routed model then does not do the writing.
- A budget target below a model's lowest supported level leaves that agent needing a choice. Do not round up silently.

### 5. Write the configuration

When the host supports per-child selection, create the parent directory when
needed and overwrite the selected file so re-runs remain idempotent. Preserve
unrelated existing lines that are still valid, including comments and
non-role configuration, unless the user asked to replace them. Preserve the
confirmed role choices and record the applied budget as `# budget: <label> (<target>)`.
For `unlimited`, record `# budget: unlimited (keep current efforts)`. Omit the budget
line if the host has no reasoning control. When the host accepts separate reasoning
arguments, add `<workflow role> reasoning: <effort>` entries. Panel reasoning lists
must match the model list in length and order, using `host-default` for entries
without an explicit effort. Keep those entries out of model ID values. Use concrete
detected model IDs in this shape. Replace every placeholder with a model the
current host reported, and use `inherit-parent` only when the host supports it.
Panel examples below have two seats. Keep the user's longer or shorter confirmed list. A confirmed one-entry panel is one
participant, not an implicit two-seat default:

```md
# pstack role and model configuration
# Values are concrete provider/model-id choices confirmed by the host.
feature, refactoring: <implementer-model>
bug-fix: <implementer-model>
perf-issue: <implementer-model>
hillclimb: <implementer-model>
judgment and prose: <reviewer-model>
hardest tasks: inherit-parent
how explorer: <explorer-model>
how explainer: <synthesizer-model>
why investigators: <researcher-model>
why synthesizer: <synthesizer-model>
reflect tooling: <researcher-model>
reflect judgment: <reviewer-model>
reflect divergent: <divergent-model>
reflect synthesizer: <synthesizer-model>
arena runners: <planner-model>, <reviewer-model>
arena cross-judge pool: <reviewer-model>, <planner-model>
swarm workers: <implementer-model>
architect runners: <planner-model>, <reviewer-model>
interrogate reviewers: <reviewer-model>, <planner-model>
```

For OMP, confirm the project save with the host's structured ask tool, then write routing to the project's `.omp/config.yml` once the confirmed choices pass validation:

1. Create `.omp/` when it is missing. Edit the file in place and keep every unrelated key, comment, and `task.*` setting. When a `task:` mapping already exists, add or change keys inside it. Never add a second `task:` block or rewrite the file wholesale.
2. Under `task.agentModelOverrides`, set one entry for each live agent in the confirmed plan, keyed by the exact agent name, with the confirmed selector as the value. Leave entries for agents setup does not own untouched, such as a plugin agent's. Remove the project entry only when the user chose `inherit-parent` for that agent. Never write a canonical role name as a key, and never write a `model` field into a task item. Do not use `omp config set` for this key, because it writes the user's global layer.
3. Fill each `.pstack/config.md` placeholder with the selector of the agent its role maps to, level included, so both files record the same selectors. A panel entry is the selector of the agent its role placeholder maps to, so entries that map to one agent repeat one value. The level rides the selector, so write no `<workflow role> reasoning:` entries and list any existing ones that the selectors replaced.
4. Run `omp config get task.agentModelOverrides --json` from the project root. OMP merges the project map with the user's by agent name, so the output is the effective map. Confirm that each key setup wrote reads back with the written value, and report any that does not. When the user chose `inherit-parent` for an agent that a user-level entry still routes, report that entry instead of editing the user's file.

```yaml
task:
  agentModelOverrides:
    scout: <provider>/<model>:<level>
    reviewer: <provider>/<model>:<level>
    security-reviewer: <provider>/<model>:<level>
    task: <provider>/<model>:<level>
    sonic: <provider>/<model>:<level>
```

Include only agents in the live roster and models the host confirmed. OMP does not carry the `reviewer` entry over to `security-reviewer`, so configure each agent you want routed.

For Pi with `pi-subagents`, also preserve unrelated keys and update the project's
`.pi/settings.json` with the concrete model assignments for the discovered
subagent names. Use this mapping unless the user chooses different agents:

| pstack role | pi-subagents agent |
| --- | --- |
| `explorer`, `watcher` | `scout` |
| `researcher` | `researcher` |
| `implementer`, `mechanical` | `worker` |
| `reviewer` | `reviewer` |
| `planner`, `synthesizer` | `oracle` |
| `owner` | `delegate` |

Write the selected IDs under `subagents.agentOverrides.<agent>.model`:

```json
{
  "subagents": {
    "agentOverrides": {
      "scout": { "model": "<explorer-model>" },
      "researcher": { "model": "<researcher-model>" },
      "worker": { "model": "<implementer-model>" },
      "reviewer": { "model": "<reviewer-model>" },
      "oracle": { "model": "<planner-model>" },
      "delegate": { "model": "<owner-model>" }
    }
  }
}

```

Write host-specific reasoning settings only when the detected host facility
documents the field and confirms support for the selected model. A model inventory
alone does not establish reasoning support.

For OpenCode, do not write `.pi/settings.json`. Keep the concrete model choices in
the user's existing `opencode.json` or `opencode.jsonc`, and use the live
OpenCode agent names in the pstack role map. Preserve unrelated configuration.


### 6. Confirm

If a concrete configuration was written, tell the user the exact path and list
the model IDs and applied reasoning efforts assigned to each role family. State
any unsupported budget choices and any roles that retain host defaults. List any
retired lines that were dropped. For Pi, name both `.pstack/config.md`
and `.pi/settings.json`, and tell the user to run `/subagents-models` to inspect
the live mapping. For OpenCode, name the `opencode.json` or `opencode.jsonc`
path used. State that configuration does not create models, child agents,
permissions, or delegation facilities.

For OMP, name `.omp/config.yml` and `.pstack/config.md`, and list each agent with its selector and the roles it serves. Say that OMP reads routing before each spawn, so only children spawned afterward use it and no restart is needed. Label every value a configured model. A child's resolved and invoked models come only from its journal, as [Child model provenance](../pstack-pi/references/omp.md#child-model-provenance) describes. Report each shared-agent collapse, each budget a model could not meet, and each `task.prewalk` or `task.agentPrewalk` handoff.

If the host lacks per-child model selection, report that no role configuration was
written or activated. Name the missing capability. Explain how to switch the active
model only when the current host documents a model-switching command.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof, such as a `verify-*` skill or an existing harness. If not, offer once to invoke the sibling **create-verification-skill** skill. On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

If the project has no skill that runs a model checker or proof, offer once to invoke the sibling **create-formal-verification-skill** skill. On no, move on without pushing.

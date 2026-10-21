# OMP binding for the pstack runtime contract

Read this after the [portable runtime contract](runtime.md) when the host is OMP. The
rules follow the OMP 18.12.5 docs for `task`, `wait`, and Agent Hub, and a persisted
child journal from that release. The live tool descriptions win when they differ.

## Model routing

A task item never carries a worker model on OMP. When `seance` is spawnable, the live
schema lists a `model` field. That field belongs to `agent: "seance"` consults, so leave
it out of every other item. Pick a child's model by picking its agent, then configure
that agent.

- **Precedence.** `task.agentModelOverrides.<agent>` comes first, then the agent
  definition's `model`, then the configured `task` role or the session fallback. A value
  is a selector or a `@role` alias that `modelRoles` defines. OMP matches the key
  against the exact agent name, so `security-reviewer` does not use the `reviewer`
  entry.
- **Where.** The project's `.omp/config.yml` and the user's `config.yml` under
  `~/.omp/agent/` both hold it. OMP merges the two maps by agent name. The project entry
  wins for the same agent, and a user entry for another agent still applies, so
  `omp config get task.agentModelOverrides --json` shows the effective map. Generic
  settings writes, including `omp config set`, target the user's global layer, so edit
  the project file directly instead of running `omp config set` for this key.
- **Timing.** OMP re-reads settings before each spawn. A changed entry applies to
  children spawned afterward and leaves a running child alone.
- **Inherit.** `inherit-parent` means no entry. The child then runs on the agent's own
  definition or the OMP fallback, which can differ from the conversation model. Check
  the child's resolved model before claiming inheritance.
- **Mid-run changes.** A child can change models while it runs. With `task.prewalk` or
  `task.agentPrewalk.<agent>` on, it hands off to the `smol` model role at its first
  edit or write, and `retry.fallbackChains` can substitute a model after a failure. The
  routed model is then not the only model that did the work.
- **Shared agents.** `explorer` and `watcher` share `scout`, and so does `researcher`
  when `librarian` is absent. `reviewer` and `synthesizer` share `reviewer`.
  `implementer` and `owner` share `task`, and so do `planner` and `designer` when
  `designer` is absent. Roles that share an agent share one model, and a panel whose
  seats run through one agent has N participants on one model. Independent models need
  distinct agents, for example project agents in `.omp/agents/<name>.md` that set
  `model`. Setup collapses roles that share an agent to one choice.
- **Check before dispatch.** A role's line in `.pstack/config.md` is a request. Only the
  mapped agent's effective entry routes the child. Before you dispatch a child whose
  model comes from such a line, run `omp config get task.agentModelOverrides --json`
  from the project root and compare the agent's entry with the line, level included.
  Resolve a `@role` value through `modelRoles` first. Report a mismatch, a missing entry,
  or a line that `omp models --json` no longer lists. Name both values and the routing
  the child will use, which is the agent's entry or, without one, the agent definition
  or the OMP fallback. Do not claim the configured choice applied. Ask the user only
  when the run depends on that model, such as a claim of model independence. Never edit
  `.omp/config.yml`, `.pstack/config.md`, or the user's `config.yml` to make them agree
  outside setup. The command reads saved settings, so a `--config` overlay or a runtime
  override can still differ, and the child's journal shows what ran.

## Reasoning controls

OMP has three reasoning controls.

- **Level on the routed selector.** `<provider>/<model>:<level>` takes only a level from
  that model's `thinking` list in `omp models --json`. A model with `thinking: null`
  takes none. The level belongs to the agent, so roles that share an agent share it. A
  fixed level stops the `auto` classifier for that agent.
- **Per-item `effort`.** `lo`, `med`, or `hi`, present only when `task.enableEffort` is
  true (default false). It maps onto the model's lowest, middle, or highest supported
  level, `task.maxEffort` caps it, and it overrides the agent's selector including
  `auto`. Omit `effort` entirely when the live schema does not list it.
- **Agent default.** An override without a level keeps the agent's own selector. The
  bundled `task` agent uses `auto`. `scout` and `sonic` use `medium`.

Fill `solutionSpace` on every task item. State how open the problem is, not how large
the work is. `one fix: rename, names given` and `deadlock cause open, no repro` are the
right shape. OMP gives that field alone to the `auto` classifier, so copied task text or
a size estimate misprices the child's reasoning. A fixed level or an `effort` value makes
OMP ignore the field, and a blank value falls back to classifying the task text.

## Child model provenance

Report three facts about a child's model and keep them apart. Where other skills say
"returned resolved-model metadata", they mean the evidence below.

| Fact | Evidence | Meaning |
| --- | --- | --- |
| Configured | `task.agentModelOverrides`, the agent definition's `model`, or `modelRoles` | The routing you intended. It does not show that a child ran or which model answered. |
| Resolved | `agent`, `modelRole`, and `resolvedModel` in the child's latest `session_init`, and each `model_change` with its `role` and `resolvedModelIsFallback` | The model OMP chose for the child, and whether a retry fallback chose it. |
| Invoked | `provider`, `model`, and `stopReason` on each assistant `message` | The model that wrote each reply. A message with `stopReason` `error` or `aborted` is a failed attempt. It shows that OMP called the model and does not show a reply. |

The child's own words about its model are a claim, not evidence. `model_usage` entries
record auxiliary calls, such as `purpose: task-completion-probe` or `auto-thinking`.
List them apart. They never count as invocations, even when they name the same model as
the child's replies. OMP persists these records in the child's session journal, and the
TUI shows the resolved model to a person. An agent reads the journal.

Read the journal of a child you started and no other. Never search session directories
for it, and skip `__advisor*.jsonl` files there, which are advisor transcripts and not
children.

1. Record the agent id that `task` returned.
2. In the bash tool, read `$PI_SESSION_FILE` and `$PI_SESSION_ID`. OMP sets both on every
   bash call. They name the session that runs the call, which is the session that
   started the child. `PI_SESSION_FILE` is the transcript's absolute path, and it is
   empty when the session is not persisted (`--no-session`). An empty value means no
   journal, so stop and report it unavailable. Read the variables in the session that
   started the child, because `/fork`, `/new`, and `/resume` change them.
3. The child's journal is `${PI_SESSION_FILE%.jsonl}/<id>.jsonl`. Read that exact path.
   When it does not exist, report the journal unavailable. Never glob or search session
   directories for it.
4. Bind the journal to your session. Its header entry (`type: "session"`) must carry a
   `parentSession` equal to `$PI_SESSION_FILE` or `$PI_SESSION_ID`. OMP documents
   `parentSession` as an opaque lineage string, so accept either form and reject a
   missing value or any other session. Physical line 1 is a padded `title` entry, so
   find the `session` record instead of reading the first line.
5. Extract only the fields below, because the journal also holds prompts and tool
   output. This `jq` program prints them in order.

   ```bash
   jq -c '
     if .type=="session" then {type, id, parentSession}
     elif .type=="session_init" then {type, agent, modelRole, resolvedModel, retryFallback, runtime}
     elif .type=="model_change" then {type, model, role, resolvedModelIsFallback}
     elif .type=="model_usage" then {type, purpose, provider, model}
     elif .type=="message" and .message.role=="assistant" then {type, provider: .message.provider, model: .message.model, stopReason: .message.stopReason}
     else empty end' "${PI_SESSION_FILE%.jsonl}/<id>.jsonl"
   ```

6. Report invocations in order. Count a child as invoked only when at least one
   assistant message has a `stopReason` other than `error` or `aborted`, and list failed
   attempts apart. Keep repeats when a child moves from model A to B and back to A, and
   summarize one model only when every successful message agrees. Assistant messages
   carry no level, so compare them with the configured selector on `provider/model`.
   Strip a trailing thinking suffix only from `inherit`, `off`, `minimal`, `low`,
   `medium`, `high`, `xhigh`, `max`, and `auto`. `max` and `auto` count only when the
   whole string is not a catalog ID, because IDs such as `glm-4.7:max` exist. Any other
   colon, as in `openrouter/<model>:free`, belongs to the model ID. OMP also reads an
   unambiguous abbreviation of a suffix word, such as `:med`, so expand it before you
   compare. Compare the configured selector with `resolvedModel` in full, level
   included, since the level fixes the agent's reasoning.
   Report a missing `resolvedModelIsFallback` as `unknown`, never `false`. A
   `model_change` with `role: "fallback"` marks a temporary retry model. Report it as
   observed and let the successful assistant messages say which model answered. Never
   infer a fallback from a difference between configured and invoked values.

When no journal exists, because `PI_SESSION_FILE` is empty (the parent ran with
`--no-session`), the exact path is missing, or the journal does not bind to your
session, report resolved and invoked as `unavailable` and fallback as `unknown`. When
the journal lacks one event type, mark only that field `unavailable` and keep the rest.
When no assistant message succeeded, report invoked as `none` and list the failed
attempts. Never fill a gap from configuration, from `task` output, or from the child's
own words.

When a workflow asks for model identity or claims independence, write one compact record
per child with `agent`, `role`, `configured`, `resolved`, `invoked`, `fallback`, and
`evidence`, where evidence is the journal path. Keep every model transition. Add
`runtime.version` from the journal entries when present, so a later reader knows which
OMP produced the evidence. Do not print a provenance table that nobody asked for.

## Workspace roots

A non-isolated Task starts in the parent's working directory. The task call has no cwd
or path field, so `git worktree add` or `omp worktree add` does not move a later Task
into the new worktree. A brief can name an absolute worktree path, but the child's
relative paths and shell stay in the parent checkout, and a relative edit lands there.
Do not use a path in a brief to redirect a writer.

`isolated: true` is the supported way to give a writer its own root. The field exists
only when `task.isolation.enabled` is true (default false) and plan mode is off, and a
spawn needs a Git repository. OMP captures a baseline of each repository's uncommitted
state before the child starts, up to 1 GiB per repository, and a larger snapshot fails
before the child starts. It runs the child in a separate workspace and captures the
child's changes as a patch, or as a branch when `task.isolation.merge` is `branch`.

Isolation separates roots. It is not a sandbox. OMP runs every child with
`tools.approvalMode` set to `yolo` and promises no containment for absolute paths, `..`,
symlinks, or effects outside the repository.

By default (`task.isolation.apply: true`) OMP applies a successful child's changes to the
parent checkout. To hold them for review, set `task.isolation.apply: false` in OMP
settings. It is a setting, not a task field. OMP then keeps the patch or branch
artifacts, and you integrate them on purpose. Nested repositories get their own patch
files.

Concurrent writers need separate roots or write sets you can prove disjoint. When the
schema offers no `isolated` field and the write sets overlap, run the writers one after
another, or stop and tell the user what to enable. Do not enable isolation for the user.

Capture the parent baseline before dispatch:

```bash
git rev-parse --show-toplevel
git rev-parse HEAD
git status --porcelain=v1 --untracked-files=all
git diff --binary HEAD | git hash-object --stdin
```

Repeat the four commands after the children finish and compare. The digest covers
tracked content, including dirty files. The status lists untracked paths and not their
content, and Git omits ignored files and everything outside the repository. Hash the
untracked or generated files a child might touch with `git hash-object <path>`. Commit or
checkpoint uncommitted work that a writer must build on, because a dirty parent is both
input and risk. If the parent changed in a way the plan did not expect, stop and keep
the evidence. Do not revert it on your own.

Before replacing a stalled, failed, or stale child, settle who owns its work.

1. `read proc://` and `read history://<id>` show whether the old child still runs and
   what it changed.
2. A kept-alive isolated child holds its workspace while idle or parked, and a message
   may revive it. An explicit release (`x` in Agent Hub, or `write proc://<id>/kill` on
   an owned agent) captures its final patch or branch and cleans the workspace.
3. Read the captured changes or the parent diff, decide to keep, apply, or discard them,
   and then start the replacement with the prior report and that decision in its brief.
   Never start a second writer on output the first one still owns.

## Task lifecycle

- **Dispatch.** With `task.batch` on (the default), `task` takes a required shared
  `context` and a `tasks[]` list. Put `agent` on each item, because a batch call rejects
  a top-level `agent`. With `async.enabled` on (the default), `task` returns agent ids
  and job ids at once, and OMP delivers each result to the root as a follow-up message.
  Keep working. With it off, the call blocks and returns the results. `task.maxConcurrency`
  (default 32) bounds how many children run at once.
- **Wait.** `wait` takes no arguments. It returns on the first settled job you own or the
  first peer message, and it consumes what it returns. With no job or service to wait
  on, it still blocks for a reply when you sent a direct message (not a broadcast)
  during this run to an agent that is still running and has not answered. Any incoming
  message ends that wait, and so does the moment no asked agent can still answer,
  because each finished its turn without replying or is blocked on you. Otherwise it
  returns "Nothing to wait for" at once and names any agent you asked that finished
  without replying. A steering message interrupts it, and a 30-minute cap ends it. Call
  it only when blocked with no other work, and call it again to drain more
  participants.
- **Inspect.** `read proc://` lists jobs and services, and `read proc://<id>` shows state
  and output without consuming delivery. `read history://<id>` shows the child's
  transcript, follow-ups included, and bare `history://` lists registered and on-disk
  agents. `agent://<id>` holds the saved final output. Before that exists, it reports the
  child's status, the `yield` payloads so far, and the latest text. A delivered preview
  can be truncated, so read `agent://<id>` for the full report.
- **Message.** `write agent://<id>` sends a peer message over OMP IRC, the transport for
  messages between parent and child and between siblings. It needs `write` in the
  sender's tools and a peer to reach, and plan mode disables it. `agent://all`
  broadcasts to live peers. A delivered message does not prove the child acted on it, so
  check `history://<id>` for the reply or the change.
- **Revive.** A finished child stays `idle` whether it succeeded or failed. After
  `task.agentIdleTtlMs` (default 420000 ms) it becomes `parked`, which releases the live
  session and keeps the journal. A message revives an idle, parked, or killed child from
  its journal, and a killed child returns as a fresh generation with its history.
  Isolated children keep their workspace through idle and parked, but OMP's session notes
  still mark isolated children as not cold-revivable. Treat resuming an isolated child as
  unconfirmed until its reply appears in `history://<id>`.
- **Republish.** A successful follow-up that the parent sent directly can republish
  `agent://<id>`. Broadcasts, peer-only replies, cancelled follow-ups, and empty
  follow-ups do not. Do not assume `agent://<id>` still holds the first result, and read
  `history://<id>` for the whole exchange.
- **Cancel.** `write proc://<id>/kill`, with no content, stops an owned job or subagent.
  A cancelled job stops the run and leaves the agent `idle` and resumable. Killing an
  agent releases its session. Cancellation is not rollback. Partial writes and
  transcripts remain, and the result file can be missing or partial, so inspect side
  effects first.
- **Retention.** A child's result, transcript, and patch live as `<id>.md`, `<id>.json`,
  `<id>.jsonl`, and `<id>.patch` in the artifacts directory of the session that started
  it. A parent that does not persist its session uses a temporary directory. Registered
  agents last until the OMP process exits, and only the files survive after that.
- **Agent Hub.** Agent Hub (`Alt+A`) is a TUI for people. It lists agents with their
  resolved models and usage, and it steers, revives (`r`), and kills (`x`). Models use
  `proc://`, `agent://`, `history://`, and `wait`. No model-facing hub tool exists.

## Session recovery

Keep the root session id or journal path in the project's durable checkpoint. Prefer
`omp --resume <id-or-jsonl-path>` for a known conversation; `omp --continue` selects
the previous session rather than a specific recorded one. Reuse `--session-dir`
when the journal lives outside the default store. A session started with
`--no-session` has no journal to reopen.

Current OMP also exposes `omp --restore <id-or-jsonl-path>` to resume an interrupted
turn and its subagents. Use that only when the interrupted work should continue,
after reconciling ownership and side effects. Reopening a conversation alone is not
proof that its old workspace, branch, processes, or child agents still exist.

Before resuming writes, verify the actual repository root, branch, HEAD, dirty state,
and retained patches against the checkpoint. Use
`skill://poteto-mode/playbooks/pause-safely.md` to record the checkpoint and
`skill://poteto-mode/playbooks/session-pickup.md` to reconstruct it. A `local://`
artifact from another root is not a durable project handoff by itself.

# oh-my-pstack

<img src="assets/logo.png" alt="pstack logo" width="128">

An unofficial Oh My Pi-first port of Lauren Tan's Cursor pstack: deliberate workflows, native delegation, and evidence you can inspect.

## Start with Oh My Pi

Install from GitHub:

```bash
omp install https://github.com/JonathanPitre/oh-my-pstack
```

Start a fresh OMP session, then run:

```text
/skill:setup-pstack
/skill:poteto-mode Fix the bug and show failing and passing evidence.
```

Confirm installation with `omp plugin list --json` and `omp read skill://poteto-mode`.

Git installation is the supported path today. An npm package named `pstack-pi` is prepared for the `omp` dist-tag, but that package is not published yet. Do not use `omp install npm:pstack-pi` until a matching GitHub Release has actually published it.

## What you get

- `/skill:poteto-mode` chooses a playbook and keeps the step order.
- `/skill:setup-pstack` reads the live OMP model inventory, saves per-agent model routing in the project's `.omp/config.yml`, and records role choices and reasoning in `.pstack/config.md`.
- Native OMP `task` delegation through `pstack-pi`. OMP picks a child's model by agent name, not per task item.
- The upstream pstack skills, playbooks, and principles, plus this fork's OMP adapters.

Subagents and review panels spend extra tokens. Setup can select cheaper supported models, less reasoning, or fewer panel seats. A model list is not a delegation facility.

OMP has native task agents. Native Pi still needs `pi-subagents` for the same kind of per-role work. Cursor Custom Modes and `/loop` are source-host features; this port does not provide them.

This package version is `0.15.13-omp.1`. That is a fork release on the Cursor `0.15.13` baseline at commit `77526ffa67f8dafc698d14b5356e6d4fc78c3127`, recorded in `upstream.lock.json`. Sync updates the source pin. It does not rewrite the fork version.

## Limits on OMP

- OMP picks a model per agent, not per task item. Roles that run through one agent share its model, so a panel whose seats use one agent runs one model.
- Saved routing is configuration, not proof. A child's resolved and invoked models appear only in its persisted journal, which the [OMP binding](skills/pstack-pi/references/omp.md) shows how to read.
- A manual worktree does not move a Task's working directory. `isolated: true` separates workspace roots when `task.isolation.enabled` is on, and it is not a sandbox.
- Agent Hub (`Alt+A`) is a terminal UI for people. Agents use `wait`, `proc://`, `agent://`, and `history://`.

## Guides

- [Install on other hosts](docs/installation.md)
- [Maintain, verify, and release](docs/maintenance.md)
- [Runtime contract](skills/pstack-pi/references/runtime.md)
- [OMP binding](skills/pstack-pi/references/omp.md)
- [Upstream reconciliation](docs/upstream-compatibility-design.md)
- [Changes](CHANGES.md)

## License and attribution

MIT. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.

The pstack-derived material is adapted from Lauren Tan's original work in `cursor/plugins`.

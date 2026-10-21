# Changes

## 0.15.13-omp.1 — unreleased

### Release provenance

- Keep matching fork package/plugin versions independent of Cursor source versions; synchronization never rewrites fork manifests.
- Record a valid source SemVer beside the exact source commit, reject mixed reviewed metadata, and allow explicit same-pin source-version repair.
- Use `0.15.13-omp.1` for this fork release and the `omp` npm distribution channel, separate from the pinned Cursor `0.15.13` source.
- Protected local ownership now includes `skills/poteto-help/` together with the OMP adapters; help, setup, and runtime instructions describe this host rather than Cursor UI.
- Scheduled synchronization proposes owned `skills/` and `upstream.lock.json` changes only. Candidate validation runs without repository write credentials. The uploaded artifact is only `proposal.patch` and `metadata.json`. Proposals are not merged automatically.

### OMP behavior

- Isolated OMP installation loads the complete packaged skill catalog from the candidate, including `pstack-pi`, `orchestrate-omp`, and `poteto-help`.
- Setup discovers OMP models and routing with native inventory commands, writes project `.omp/config.yml` per-agent overrides alongside `.pstack/config.md`, preserves unrelated settings, and does not create `.pi/settings.json` or change global configuration. Roles sharing an agent share its model choice.
- Native workflow dispatch maps planner to `task` and researcher to `scout` when designer and librarian are disabled, consumes full `agent://` results, and yields finite native async jobs instead of polling in-turn.
- Without a scheduler, lifecycle work records a manual checkpoint rather than inventing a portable `/loop`.
- Authenticated smoke keeps the disposable workspace on failure so traces remain inspectable, and it does not treat a skipped run as passing.
- Add `scripts/omp-provenance.mjs` and credential-free tests: child journals are bound to their parent by `parentSession`, invoked models come only from assistant messages, and A/B/A sequences, unknown or missing metadata, fallbacks, auxiliary `model_usage`, and malformed journals are distinguished or rejected. See `skills/pstack-pi/references/omp.md#child-model-provenance`.
- The authenticated smoke now seeds a project `.omp/config.yml`, requires setup to add live-agent `task.agentModelOverrides` without disturbing unrelated keys, and proves the routed child model from its persisted journal against a parent on a different model. It no longer asserts per-item `model` fields; that field belongs to seance.
- The smoke also covers native isolation with auto-apply disabled (separate root, relative write captured in a patch, parent unchanged) and subagent lifecycle with a direct follow-up read through `history://`. Both phases passed on OMP 18.12.5, together with routing from a `gpt-6-luna` parent to a `gpt-6.1-sol` child.
- Host identity now comes from the active runtime rather than installed executables. The OMP binding documents `solutionSpace`, configured/resolved/invoked model evidence, workspace ownership, and current messaging, cancellation, and revival limits.
- Session recovery guidance covers `--resume`, `--continue`, `--restore`, and `--session-dir`, with checkpoint and workspace checks before writes resume.
- Follow-up smoke checks recognize inline IRC request boundaries in `history://` transcripts and require a later assistant reply. Echoed requests no longer count as replies.

### Upstream synchronization

- Apply upstream executable-mode changes even when file contents are unchanged, including same-revision mode repair.
- Preserve existing read/write permissions and deliberately local modes on adapted files; mode-only updates do not rewrite unchanged read-only content.
- Reconstruct the same applicable mode during reviewed application and replay, including explicit conflict resolutions.
- Reject unreadable local inputs without advancing the source pin or changing their permissions.
- Review exports now require a fresh leaf under an existing parent; reused directories and canonical paths inside the destination are rejected.
- Generate private review directories and files exclusively, without following pre-existing output links; validate review subdirectories before reading snapshots or decisions.

### Package integrity

- Validate decoded local references, named-skill URI boundaries, reference-style Markdown, and the README's HTML logo against lexical and canonical package ownership.
- Reject escaping symlinks, directory targets, missing resources, and links to existing files omitted from the npm allowlist.
- Ship the linked upstream compatibility reference and verify the real extracted npm artifact, including complete consumable skill resources and rejection after an installed resource is lost.
- Make skill-only documentation links self-contained or public, including an explicit example index instead of a directory target.


[You have received this identical output 3 times. Re-reading '/home/johndoe/Work/oh-my-pstack/CHANGES.md:raw' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]
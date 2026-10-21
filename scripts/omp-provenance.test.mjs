import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { assertInvokedOnly, childJournals, completed, findReply, historyShowsReply, pairedCalls, parseJournal, resultIncludes, resultText, splitSelector, summarize } from "./omp-provenance.mjs";

const title = { type: "title", v: 1, title: "", pad: " ".repeat(40) };
const header = (extra = {}) => ({ type: "session", version: 3, id: "child-id", cwd: "/work", ...extra });
const said = text => [{ type: "text", text }];
const assistant = (provider, model, stopReason = "stop", content = []) => ({ type: "message", message: { role: "assistant", provider, model, stopReason, content } });
const user = content => ({ type: "message", message: { role: "user", content } });
const notFallback = model => ({ type: "model_change", model, resolvedModelIsFallback: false });
const jsonl = (...entries) => `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`;
const parsed = (entries, head = header()) => parseJournal(jsonl(title, head, ...entries));
const journal = (entries, head = header()) => summarize(parsed(entries, head));
const put = (path, head, ...entries) => writeFile(path, jsonl(title, head, ...entries));

async function withDirectory(run) {
  const dir = await mkdtemp(join(tmpdir(), "omp-provenance-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// OMP stores a session at `<stamp>_<id>.jsonl` and its children in the sibling directory `<stamp>_<id>/`.
async function family(dir, { id = "parent-id", stamp = "2026-01-01T00-00-00-000Z" } = {}) {
  const artifacts = join(dir, `${stamp}_${id}`);
  await mkdir(artifacts, { recursive: true });
  return { parent: join(dir, `${stamp}_${id}.jsonl`), artifacts };
}

test("an A/B/A model sequence stays three invocations, not one model", () => {
  const summary = journal([assistant("p", "a"), assistant("p", "a"), assistant("p", "b"), assistant("p", "a")]);
  assert.deepEqual(summary.invoked, ["p/a", "p/b", "p/a"]);
  assert.equal(summary.attempts.length, 4);
  assert.throws(() => assertInvokedOnly(summary, "p/a"), { code: "model-mismatch" });
});

test("an assistant message without provider or model is unknown and never defaulted to the expected model", () => {
  const summary = journal([assistant("p", "a"), { type: "message", message: { role: "assistant" } }]);
  assert.deepEqual(summary.invoked, ["p/a", "unknown"]);
  assert.throws(() => assertInvokedOnly(summary, "p/a"), { code: "missing-metadata" });
});

test("a journal with no assistant message proves nothing, even when a model_change names the expected model", () => {
  const summary = journal([notFallback("p/a"), { type: "session_init", agent: "task", resolvedModel: "p/a:low" }]);
  assert.deepEqual(summary.invoked, []);
  assert.deepEqual(summary.attempts, []);
  assert.throws(() => assertInvokedOnly(summary, "p/a"), { code: "no-invocation" });
});

test("auxiliary usage is reported separately and is not an invocation, even on a different or identical model", () => {
  const summary = journal([assistant("p", "a"), { type: "model_usage", purpose: "auto-thinking", role: "judge", provider: "q", model: "z" }, { type: "model_usage", purpose: "task-completion-probe", provider: "p", model: "a" }]);
  assert.deepEqual(summary.invoked, ["p/a"]);
  assert.deepEqual(summary.auxiliary, [{ purpose: "auto-thinking", role: "judge", model: "q/z" }, { purpose: "task-completion-probe", role: undefined, model: "p/a" }]);
  assertInvokedOnly({ ...summary, resolved: [{ model: "p/a", role: "default", fallback: false }] }, "p/a");
  const auxiliaryOnly = journal([{ type: "model_usage", purpose: "task-completion-probe", provider: "p", model: "a" }]);
  assert.throws(() => assertInvokedOnly(auxiliaryOnly, "p/a"), { code: "no-invocation" });
});

test("a resolved fallback fails even when the assistant model matches", () => {
  const summary = journal([{ type: "model_change", model: "p/a", resolvedModelIsFallback: true }, assistant("p", "a")]);
  assert.throws(() => assertInvokedOnly(summary, "p/a"), { code: "fallback" });
});

test("absent fallback metadata stays unknown and is rejected, as is a journal with no model_change", () => {
  const unrecorded = journal([{ type: "model_change", model: "p/a" }, assistant("p", "a")]);
  assert.equal(unrecorded.resolved[0].fallback, null);
  assert.throws(() => assertInvokedOnly(unrecorded, "p/a"), { code: "fallback" });
  assert.throws(() => assertInvokedOnly(journal([assistant("p", "a")]), "p/a"), { code: "fallback-unknown" });
  assertInvokedOnly(journal([notFallback("p/a"), assistant("p", "a")]), "p/a");
});

test("only a completed assistant response proves an invocation; failed attempts are kept but never count", () => {
  for (const stopReason of ["error", "aborted"]) {
    const failed = journal([notFallback("p/a"), assistant("p", "a", stopReason), assistant("p", "a", stopReason)]);
    assert.throws(() => assertInvokedOnly(failed, "p/a"), { code: "no-invocation" });
  }
  const unrecorded = journal([notFallback("p/a"), { type: "message", message: { role: "assistant", provider: "p", model: "a", content: [] } }]);
  assert.throws(() => assertInvokedOnly(unrecorded, "p/a"), { code: "no-invocation" });
  const retried = journal([notFallback("p/a"), assistant("p", "a", "error"), assistant("p", "a", "stop")]);
  assert.deepEqual(retried.attempts, [{ model: "p/a", stopReason: "error" }, { model: "p/a", stopReason: "stop" }]);
  assertInvokedOnly(retried, "p/a");
  const elsewhere = journal([notFallback("p/a"), assistant("p", "b", "error"), assistant("p", "a", "stop")]);
  assert.throws(() => assertInvokedOnly(elsewhere, "p/a"), { code: "model-mismatch" });
});

test("a catalog entry wins over level parsing; otherwise only known levels are stripped and other colons are kept", () => {
  const catalog = new Set(["zai/glm-4.7", "zai/glm-4.7:max", "openrouter/vendor/model:free"]);
  assert.deepEqual(splitSelector("p/m:low"), { base: "p/m", level: "low", source: "level" });
  assert.deepEqual(splitSelector("p/m"), { base: "p/m", level: null, source: "none" });
  assert.deepEqual(splitSelector("p/m:inherit"), { base: "p/m", level: "inherit", source: "level" });
  assert.deepEqual(splitSelector("p/m:auto"), { base: "p/m", level: "auto", source: "level" });
  assert.deepEqual(splitSelector("zai/glm-4.7:max", catalog), { base: "zai/glm-4.7:max", level: null, source: "catalog" });
  assert.deepEqual(splitSelector("zai/glm-4.7:max:low", catalog), { base: "zai/glm-4.7:max", level: "low", source: "level" });
  assert.deepEqual(splitSelector("zai/glm-4.7:high", catalog), { base: "zai/glm-4.7", level: "high", source: "level" });
  assert.deepEqual(splitSelector("zai/other:max", catalog), { base: "zai/other", level: "max", source: "level" });
  assert.deepEqual(splitSelector("zai/glm-4.7:max"), { base: "zai/glm-4.7", level: "max", source: "level" });
  assert.deepEqual(splitSelector("openrouter/vendor/model:free", catalog), { base: "openrouter/vendor/model:free", level: null, source: "catalog" });
  assert.deepEqual(splitSelector("openrouter/vendor/model:free"), { base: "openrouter/vendor/model:free", level: null, source: "none" });
  assert.deepEqual(splitSelector("openrouter/vendor/model:free:high"), { base: "openrouter/vendor/model:free", level: "high", source: "level" });
  assert.deepEqual(splitSelector("ollama-cloud/clef:27b"), { base: "ollama-cloud/clef:27b", level: null, source: "none" });
});

test("the expected identity is exact and never stripped, so a colon id is not confused with its plain sibling", () => {
  const free = journal([notFallback("p/m:free"), assistant("p", "m:free")]);
  const paid = journal([notFallback("p/m"), assistant("p", "m")]);
  const max = journal([notFallback("p/glm:max"), assistant("p", "glm:max")]);
  assertInvokedOnly(free, "p/m:free");
  assertInvokedOnly(paid, "p/m");
  assertInvokedOnly(max, "p/glm:max");
  assert.throws(() => assertInvokedOnly(paid, "p/m:free"), { code: "model-mismatch" });
  assert.throws(() => assertInvokedOnly(free, "p/m"), { code: "model-mismatch" });
  assert.throws(() => assertInvokedOnly(max, "p/glm"), { code: "model-mismatch" });
  assert.throws(() => assertInvokedOnly(paid, "p/m:low"), { code: "model-mismatch" });
});

test("the resolved selector keeps its thinking level, and the latest session_init wins", () => {
  assert.equal(journal([{ type: "session_init", agent: "task", resolvedModel: "p/a:low" }]).resolvedSelector, "p/a:low");
  assert.equal(journal([{ type: "session_init", resolvedModel: "p/a:low" }, { type: "session_init", resolvedModel: "p/a:high" }]).resolvedSelector, "p/a:high");
  assert.equal(journal([]).resolvedSelector, undefined);
});

test("malformed, headerless and entry-less lines are rejected with their line", () => {
  assert.throws(() => parseJournal(`${JSON.stringify(header())}\n{"type":"message"\n`, "j"), { code: "malformed", message: /j:2/u });
  assert.throws(() => parseJournal("[1]\n", "j"), { code: "malformed" });
  assert.throws(() => parseJournal(jsonl(title, assistant("p", "a")), "j"), { code: "no-header" });
  assert.throws(() => parseJournal("", "j"), { code: "no-header" });
});

test("the parent is identified by its header id, not its file name", async () => {
  await withDirectory(async dir => {
    const { parent, artifacts } = await family(dir, { id: "file-id" });
    await put(parent, header({ id: "real-id" }));
    await put(join(artifacts, "ByName.jsonl"), header({ parentSession: "file-id" }), assistant("p", "a"));
    await put(join(artifacts, "ById.jsonl"), header({ parentSession: "real-id" }), assistant("p", "a"));
    assert.deepEqual((await childJournals(parent)).map(child => child.id), ["ById"]);
  });
});

test("children are bound by parentSession inside the parent's own artifact directory; every other journal is ignored", async () => {
  await withDirectory(async dir => {
    const { parent, artifacts } = await family(dir);
    const other = join(dir, "2026-01-01T00-00-01-000Z_other-id.jsonl");
    await put(parent, header({ id: "parent-id" }), assistant("p", "parent"));
    await put(other, header({ id: "other-id" }));
    await put(join(artifacts, "Bound.jsonl"), header({ parentSession: parent }), assistant("p", "child"));
    await put(join(artifacts, "ById.jsonl"), header({ parentSession: "parent-id" }), assistant("p", "child"));
    await put(join(artifacts, "Foreign.jsonl"), header({ parentSession: other }), assistant("p", "foreign"));
    await put(join(artifacts, "__advisor.jsonl"), header(), assistant("p", "advisor"));
    await mkdir(join(artifacts, "Bound"));
    await put(join(artifacts, "Bound", "Grandchild.jsonl"), header({ parentSession: join(artifacts, "Bound.jsonl") }), assistant("p", "grandchild"));
    const found = await childJournals(parent);
    assert.deepEqual(new Set(found.map(child => child.id)), new Set(["ById", "Bound"]));
    assert.ok(found.every(child => child.invoked.join() === "p/child"));
    await writeFile(join(artifacts, "Broken.jsonl"), "{nope\n");
    await assert.rejects(childJournals(parent), { code: "malformed" });
  });
});

test("sibling forks and journals outside the parent's artifact directory are neither returned nor read", async () => {
  await withDirectory(async dir => {
    const { parent, artifacts } = await family(dir);
    await put(parent, header({ id: "parent-id" }));
    await put(join(artifacts, "Child.jsonl"), header({ parentSession: parent }), assistant("p", "child"));
    await put(join(dir, "2026-01-01T00-00-02-000Z_fork-id.jsonl"), header({ id: "fork-id", parentSession: parent }), assistant("p", "fork"));
    await writeFile(join(dir, "2026-01-01T00-00-03-000Z_broken-fork.jsonl"), "{nope\n");
    const sibling = await family(dir, { id: "sibling-id", stamp: "2026-01-01T00-00-04-000Z" });
    await put(join(sibling.artifacts, "Impostor.jsonl"), header({ parentSession: parent }), assistant("p", "impostor"));
    assert.deepEqual((await childJournals(parent)).map(child => child.id), ["Child"]);
  });
});

test("a parent reached through a symlinked directory still binds children that name its real path", async () => {
  await withDirectory(async dir => {
    const real = join(dir, "real");
    await mkdir(real);
    const { parent, artifacts } = await family(real);
    await put(parent, header({ id: "parent-id" }));
    await put(join(artifacts, "Child.jsonl"), header({ parentSession: parent }), assistant("p", "child"));
    await symlink(real, join(dir, "link"));
    assert.deepEqual((await childJournals(join(dir, "link", basename(parent)))).map(child => child.id), ["Child"]);
  });
});

test("a parent that never spawned has no children, and a path that is not a session file is rejected", async () => {
  await withDirectory(async dir => {
    const parent = join(dir, "2026-01-01T00-00-00-000Z_parent-id.jsonl");
    await put(parent, header({ id: "parent-id" }));
    assert.deepEqual(await childJournals(parent), []);
    await assert.rejects(childJournals(join(dir, "session.txt")), { code: "bad-parent" });
  });
});

test("a reply is completed assistant speech, not the prompt, a tool result or a tool call that quotes the marker", () => {
  const prompt = user(said("Reply exactly MARK_7"));
  const quoting = [
    [prompt],
    [prompt, { type: "message", message: { role: "toolResult", content: said("MARK_7") } }],
    [prompt, assistant("p", "a", "toolUse", [{ type: "toolCall", name: "write", arguments: { content: "MARK_7" } }])],
    [prompt, assistant("p", "a", "error", said("MARK_7"))],
    [prompt, assistant("p", "a", "aborted", said("MARK_7"))],
    [prompt, assistant("p", "a", "stop", [{ type: "thinking", thinking: "MARK_7" }])],
  ];
  for (const entries of quoting) assert.equal(findReply(parsed(entries), "MARK_7"), undefined);
  assert.ok(findReply(parsed([prompt, assistant("p", "a", "stop", said("done MARK_7"))]), "MARK_7"));
  assert.ok(findReply(parsed([prompt, assistant("p", "a", "toolUse", [{ type: "toolCall", name: "yield", arguments: { result: { data: "MARK_7" } } }])]), "MARK_7"));
});

test("a reply to a request must come after that request", () => {
  const ask = user("please answer FOLLOWUP_9");
  const early = assistant("p", "a", "stop", said("FOLLOWUP_9 early"));
  const late = assistant("p", "a", "stop", said("FOLLOWUP_9 late"));
  assert.equal(findReply(parsed([early, ask]), "FOLLOWUP_9", "FOLLOWUP_9"), undefined);
  assert.equal(findReply(parsed([ask]), "FOLLOWUP_9", "FOLLOWUP_9"), undefined);
  assert.equal(findReply(parsed([early, late]), "FOLLOWUP_9", "FOLLOWUP_9"), undefined);
  assert.equal(findReply(parsed([early, ask, late]), "FOLLOWUP_9", "FOLLOWUP_9")?.text, "FOLLOWUP_9 late");
  const carriers = [
    { type: "message", message: { role: "developer", content: said("please answer FOLLOWUP_9") } },
    { type: "custom_message", customType: "irc", content: "please answer FOLLOWUP_9" },
  ];
  for (const carrier of carriers) assert.equal(findReply(parsed([carrier, late]), "FOLLOWUP_9", "FOLLOWUP_9")?.text, "FOLLOWUP_9 late");
  const echoed = { type: "message", message: { role: "toolResult", content: said("grep hit FOLLOWUP_9") } };
  assert.equal(findReply(parsed([echoed, late]), "FOLLOWUP_9", "FOLLOWUP_9"), undefined);
});

test("tool results are matched to their call by toolCallId, not by order or content", () => {
  const frames = [
    { type: "tool_execution_start", toolCallId: "a", toolName: "read", args: { path: "agent://One" } },
    { type: "tool_execution_start", toolCallId: "b", toolName: "read", args: { path: "agent://Two" } },
    { type: "tool_execution_start", toolCallId: "d", toolName: "ns.read", args: { path: "agent://Four" } },
    { type: "tool_execution_start", toolName: "read", args: { path: "agent://Three" } },
    { type: "tool_execution_start", toolCallId: "w", toolName: "write", args: { path: "agent://One" } },
    { type: "tool_execution_end", toolCallId: "d", toolName: "ns.read", result: "MARK_2", isError: false },
    { type: "tool_execution_end", toolCallId: "b", toolName: "read", result: "MARK_1", isError: false },
    { type: "tool_execution_end", toolCallId: "a", toolName: "read", result: "MARK_1", isError: true },
  ];
  const calls = pairedCalls(frames, "read");
  assert.deepEqual(calls.map(call => call.args.path), ["agent://One", "agent://Two", "agent://Four", "agent://Three"]);
  assert.deepEqual(calls.map(call => [call.index, call.endIndex]), [[0, 7], [1, 6], [2, 5], [3, undefined]]);
  const [one, two, four, three] = calls;
  assert.equal(resultIncludes(two, "MARK_1"), true);
  assert.equal(resultIncludes(two, "MARK_2"), false);
  assert.equal(resultIncludes(four, "MARK_2"), true);
  assert.equal(resultIncludes(one, "MARK_1"), false);
  assert.equal(completed(one), false);
  assert.equal(completed(two), true);
  assert.equal(three.end, undefined);
  assert.equal(completed(three), false);
  const [write] = pairedCalls(frames, "write");
  assert.equal(write.end, undefined);
  assert.equal(completed(write), false);
});

test("a tool result's text is read from its content blocks, and an errored or missing result never matches", () => {
  const call = { end: { result: { content: [{ type: "text", text: "first" }, { type: "text", text: "second MARK_3" }] }, isError: false } };
  assert.equal(resultText(call), "first\nsecond MARK_3");
  assert.equal(resultIncludes(call, "MARK_3"), true);
  assert.equal(resultIncludes({ end: { ...call.end, isError: true } }, "MARK_3"), false);
  assert.equal(resultIncludes({}, "MARK_3"), false);
});

test("a history transcript shows a reply only as an assistant section after the request that delivered it", () => {
  const section = (role, body) => `## ${role}\n\n${body}\n`;
  const request = "FOLLOWUP_9";
  const full = ["# Child (idle)\n", section("user", "task"), section("assistant", "CHILD_1"), section("user", `<irc from="parent">please answer ${request}</irc>`), section("assistant", `${request} done`)].join("\n");
  assert.equal(historyShowsReply(full, request, request), true);
  assert.equal(historyShowsReply(section("user", `please answer ${request}`), request, request), false);
  assert.equal(historyShowsReply([section("assistant", request), section("user", `please answer ${request}`)].join("\n"), request, request), false);
  assert.equal(historyShowsReply([section("user", `please answer ${request}`), section("user", `again ${request}`)].join("\n"), request, request), false);
  assert.equal(historyShowsReply([section("developer", `please answer ${request}`), section("assistant", `${request} done`)].join("\n"), request, request), true);
  assert.equal(historyShowsReply(["3|## user", "4|", `5|please answer ${request}`, "6|", "7|## assistant", "8|", `9|${request} done`].join("\n"), request, request), true);
  assert.equal(historyShowsReply(["3:## user", "", `please answer ${request}`, "", "7:## assistant", "", `${request} done`].join("\n"), request, request), true);
  const irc = ["1:# Child (idle)", "3:## user", "7:First assignment", "9:## assistant", "11:CHILD_1", `13:[irc] Main → me: Reply exactly ${request} and yield.`, "15:## assistant", `17:${request}`];
  assert.equal(historyShowsReply(irc.join("\n"), request, request), true);
  assert.equal(historyShowsReply(irc.slice(0, -2).join("\n"), request, request), false);
});

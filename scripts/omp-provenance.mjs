import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

export class JournalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "JournalError";
    this.code = code;
  }
}

// OMP 18.12.5 journals: JSONL, a padded `title` slot first, then the `session` header, then entries.
export function parseJournal(text, label = "journal") {
  const entries = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    let entry;
    try { entry = JSON.parse(lines[index]); } catch { throw new JournalError("malformed", `${label}:${index + 1} is not valid JSON`); }
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.type !== "string") throw new JournalError("malformed", `${label}:${index + 1} is not a journal entry`);
    if (entry.type !== "title") entries.push(entry);
  }
  const [header, ...rest] = entries;
  if (header?.type !== "session") throw new JournalError("no-header", `${label} has no session header`);
  return { header, entries: rest };
}

// Suffixes OMP accepts after a model selector (tui thinking.ts): `off`, the model levels, `inherit` and the `auto` classifier.
// Any other colon belongs to the model id (`openrouter/…:free`, `ollama-cloud/…:27b`). A selector that is itself a catalog
// entry (`glm-4.7:max`) always wins over level parsing. `source` says why the split came out as it did.
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "inherit", "auto"];

export function splitSelector(selector, catalog) {
  if (catalog?.has(selector)) return { base: selector, level: null, source: "catalog" };
  const colon = selector.lastIndexOf(":");
  const level = selector.slice(colon + 1);
  if (colon > selector.indexOf("/") && THINKING_LEVELS.includes(level)) return { base: selector.slice(0, colon), level, source: "level" };
  return { base: selector, level: null, source: "none" };
}

const named = (provider, model) => typeof provider === "string" && provider && typeof model === "string" && model ? `${provider}/${model}` : "unknown";
const finished = stopReason => typeof stopReason === "string" && stopReason !== "error" && stopReason !== "aborted";

// Invoked = what assistant messages record. Configured, resolved (model_change/session_init) and auxiliary model_usage stay separate.
export function summarize({ header, entries }) {
  const attempts = entries
    .filter(entry => entry.type === "message" && entry.message?.role === "assistant")
    .map(({ message }) => ({ model: named(message.provider, message.model), stopReason: message.stopReason }));
  const init = entries.findLast(entry => entry.type === "session_init");
  return {
    cwd: header.cwd,
    parentSession: header.parentSession,
    attempts,
    invoked: attempts.map(attempt => attempt.model).filter((model, index, all) => model !== all[index - 1]),
    resolved: entries.filter(entry => entry.type === "model_change").map(entry => ({ model: entry.model, role: entry.role ?? "default", fallback: typeof entry.resolvedModelIsFallback === "boolean" ? entry.resolvedModelIsFallback : null })),
    resolvedSelector: typeof init?.resolvedModel === "string" ? init.resolvedModel : undefined,
    agent: init?.agent,
    auxiliary: entries.filter(entry => entry.type === "model_usage").map(entry => ({ purpose: entry.purpose, role: entry.role, model: named(entry.provider, entry.model) })),
  };
}

// Throws unless the journal proves a completed assistant response and that every assistant call used `expected`,
// an already resolved exact provider/model identity that is never parsed or stripped here. Failed or aborted calls
// are kept in `attempts` but never count as the invocation.
export function assertInvokedOnly(summary, expected, label = "child") {
  const want = expected;
  if (summary.attempts.length === 0) throw new JournalError("no-invocation", `${label} journal records no assistant invocation`);
  if (summary.invoked.includes("unknown")) throw new JournalError("missing-metadata", `${label} has an assistant message without provider/model`);
  if (summary.invoked.some(model => model !== want)) throw new JournalError("model-mismatch", `${label} invoked ${summary.invoked.join(" -> ")}, expected only ${want}`);
  if (!summary.attempts.some(attempt => finished(attempt.stopReason))) throw new JournalError("no-invocation", `${label} has no completed assistant response (stop reasons: ${summary.attempts.map(attempt => attempt.stopReason ?? "unrecorded").join(", ")})`);
  if (summary.resolved.length === 0) throw new JournalError("fallback-unknown", `${label} has no model_change record, so fallback state is unknown`);
  if (summary.resolved.some(change => change.fallback !== false)) throw new JournalError("fallback", `${label} resolved a fallback model or left fallback state unrecorded`);
}

// What each record said. The child's own words are assistant text blocks or a `yield` payload; arguments of any
// other tool call are not speech. Injected `custom_message` records are kept so a delivered request is never lost.
const blocksOf = content => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []);
const textOf = block => (block?.type === "text" && typeof block.text === "string" ? block.text : "");

function conversation({ entries }) {
  return entries.flatMap((entry, index) => {
    if (entry.type === "custom_message") return [{ index, role: "custom", text: blocksOf(entry.content).map(textOf).join("\n"), ok: false }];
    if (entry.type !== "message") return [];
    const { role, content, stopReason } = entry.message ?? {};
    const text = blocksOf(content).map(block => (role === "assistant" && block?.type === "toolCall" && block.name === "yield" ? JSON.stringify(block.arguments ?? {}) : textOf(block))).join("\n");
    return [{ index, role, text, ok: role === "assistant" && finished(stopReason) }];
  });
}

// A completed assistant output containing `marker`. With `request`, only outputs after the first delivered request
// (any record that is neither the assistant's own speech nor a tool result) containing `request` count, so a prompt
// that merely quotes the marker is never taken for a reply.
export function findReply(journal, marker, request) {
  const turns = conversation(journal);
  let after = -1;
  if (request !== undefined) {
    const asked = turns.find(turn => turn.role !== "assistant" && turn.role !== "toolResult" && turn.text.includes(request));
    if (!asked) return undefined;
    after = asked.index;
  }
  return turns.find(turn => turn.ok && turn.index > after && turn.text.includes(marker));
}

// RPC tool frames paired by toolCallId: a result belongs to its own call, never by position or content.
// `index`/`endIndex` are frame positions, so callers can order one call after another.
export function pairedCalls(frames, name) {
  const ends = new Map();
  frames.forEach((frame, index) => { if (frame.type === "tool_execution_end" && typeof frame.toolCallId === "string") ends.set(frame.toolCallId, { frame, index }); });
  return frames.flatMap((frame, index) => {
    if (frame.type !== "tool_execution_start" || frame.toolName?.split(".").at(-1) !== name) return [];
    const end = typeof frame.toolCallId === "string" ? ends.get(frame.toolCallId) : undefined;
    return [{ id: frame.toolCallId, args: frame.args, index, end: end?.frame, endIndex: end?.index }];
  });
}

export const completed = call => call.end !== undefined && call.end.isError !== true;

// The text a tool returned: a string result, the text blocks of a `{ content }` result, or its JSON form.
export function resultText(call) {
  const result = call.end?.result;
  if (typeof result === "string") return result;
  if (Array.isArray(result?.content)) return result.content.map(block => (typeof block?.text === "string" ? block.text : "")).join("\n");
  return JSON.stringify(result ?? "");
}

export const resultIncludes = (call, marker) => completed(call) && resultText(call).includes(marker);

// A `history://<id>` transcript renders `## user` / `## assistant` (and `## developer`) sections. The reply is visible
// only when an assistant section containing `marker` follows the delivered section that carries `request`.
export function historyShowsReply(text, request, marker) {
  const sections = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\*?\d+[|:]/u, "");
    const heading = /^## (\S+)\s*$/u.exec(line);
    if (heading) sections.push({ role: heading[1], body: "" });
    else if (/^\[irc\] .+ → me:/u.test(line)) sections.push({ role: "irc", body: `${line}\n` });
    else if (sections.length > 0) sections.at(-1).body += `${line}\n`;
  }
  const asked = sections.findIndex(section => section.role !== "assistant" && section.body.includes(request));
  return asked >= 0 && sections.slice(asked + 1).some(section => section.role === "assistant" && section.body.includes(marker));
}

async function* journals(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* journals(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

const canonical = async path => realpath(path).catch(() => path);

// Children live in the parent's own artifact directory (`<parent file minus .jsonl>/`) and name the parent in their header.
// Forks and branches write the same header field but are siblings of the parent, not children, so both conditions are required.
export async function childJournals(parentFile) {
  if (!parentFile.endsWith(".jsonl")) throw new JournalError("bad-parent", `${parentFile} is not a .jsonl session file`);
  const parent = parseJournal(await readFile(parentFile, "utf8"), parentFile).header;
  const identities = new Set([await canonical(parentFile), ...(typeof parent.id === "string" && parent.id ? [parent.id] : [])]);
  const artifacts = parentFile.slice(0, -".jsonl".length);
  try { await readdir(artifacts); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const found = [];
  for await (const file of journals(artifacts)) {
    const journal = parseJournal(await readFile(file, "utf8"), file);
    const claimed = journal.header.parentSession;
    if (typeof claimed !== "string" || !identities.has(isAbsolute(claimed) ? await canonical(claimed) : claimed)) continue;
    found.push({ file, id: basename(file, ".jsonl"), journal, ...summarize(journal) });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

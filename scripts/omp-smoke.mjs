import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { assertInvokedOnly, childJournals, completed, findReply, historyShowsReply, pairedCalls, parseJournal, resultIncludes, resultText, splitSelector, summarize } from "./omp-provenance.mjs";
import { startOmpRpc } from "./omp-rpc.mjs";

const execute = promisify(execFile);
const candidate = await realpath(resolve(import.meta.dirname, ".."));
const requested = process.env.PSTACK_OMP_MODEL;
if (!requested?.includes("/")) throw new Error("Set PSTACK_OMP_MODEL to an exact provider/model selector");
let bin = process.env.PSTACK_OMP_BIN ?? "omp";
if (!isAbsolute(bin)) bin = (await execute("which", [bin], { timeout: 30_000 })).stdout.trim();
const inventory = JSON.parse((await execute(bin, ["models", "--json"], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout);
const catalog = new Set((inventory.models ?? []).filter(entry => entry.kind === "chat").map(entry => `${entry.provider}/${entry.id}`));
const { base: baseSelector, level: requestedThinking } = splitSelector(requested, catalog);
const provider = baseSelector.slice(0, baseSelector.indexOf("/")), modelId = baseSelector.slice(baseSelector.indexOf("/") + 1);
const metadata = JSON.parse((await execute(bin, ["models", "find", modelId, "--json", "--no-extensions"], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout);
const model = metadata.models?.find(entry => entry.provider === provider && entry.id === modelId && entry.kind === "chat");
if (!model) throw new Error(`Requested model is unavailable: ${baseSelector}`);
const supportedThinking = ["off", ...(model.thinking ?? [])];
if (requestedThinking !== null && !supportedThinking.includes(requestedThinking)) throw new Error(`Unsupported thinking selector for ${baseSelector}: ${requestedThinking}`);
const thinking = requestedThinking ?? (supportedThinking.includes("low") ? "low" : "off");
const selector = `${baseSelector}:${thinking}`;
const parentRequest = process.env.PSTACK_OMP_PARENT_MODEL;
if (parentRequest !== undefined && !parentRequest.startsWith(`${provider}/`)) throw new Error(`PSTACK_OMP_PARENT_MODEL must be a ${provider}/<model> selector`);
const alternate = inventory.models?.find(entry => entry.provider === provider && entry.kind === "chat" && entry.id !== modelId && [...(entry.thinking ?? []), "off"].includes(thinking) && (parentRequest === undefined || `${provider}/${entry.id}` === parentRequest));
if (!alternate) throw new Error(parentRequest === undefined ? `Routing proof needs a second ${provider} chat model that supports thinking "${thinking}"; set PSTACK_OMP_PARENT_MODEL to choose one` : `PSTACK_OMP_PARENT_MODEL is unavailable or equals the routed model: ${parentRequest}`);
const foreignSelector = `${provider}/${alternate.id}:${thinking}`;
let credential = process.env.PSTACK_OMP_API_KEY;
if (credential === undefined) {
  try {
    credential = (await execute(bin, ["token", provider], { timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout.trim();
  } catch (error) {
    throw new Error(`Normal OMP credential resolution failed for ${provider} (exit ${error.code ?? "unknown"}); token output is withheld`);
  }
}
if (!credential?.trim()) throw new Error(`A nonempty credential is required for ${provider}`);
const redact = value => String(value).split(credential).join("[REDACTED]").split(JSON.stringify(credential).slice(1, -1)).join("[REDACTED]");
const snapshot = async path => { try { return await readFile(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const livePaths = [".omp/agent/config.yml", ".omp/agent/settings.json", ".omp/settings.json", ".omp/plugins/package.json", ".omp/plugins/omp-plugins.lock.json"].map(path => join(process.env.HOME ?? "", path));
const liveSnapshots = new Map(await Promise.all(livePaths.map(async path => [path, await snapshot(path)])));
const root = await mkdtemp(join(tmpdir(), "pstack-omp-smoke-"));
const scenarios = [];
let rpc, lastText = "", currentScenario = "preflight";
const toolCalls = frames => frames.filter(frame => frame.type === "tool_execution_start");
const toolName = frame => frame.toolName?.split(".").at(-1);
const jsonText = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, ""));
const reported = value => typeof value === "string" ? value : value?.value;
const noPi = async project => { await assert.rejects(access(join(project, ".pi/settings.json")), { code: "ENOENT" }); };
try {
  const home = join(root, "home"), project = join(root, "project"), agentDir = join(home, ".omp/agent"), config = join(project, ".pstack/config.md");
  await Promise.all([agentDir, join(home, "tmp"), join(project, ".pstack")].map(path => mkdir(path, { recursive: true })));
  const keys = ["PATH", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "GIT_SSL_CAINFO"];
  const safeEnvironment = Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const baseEnv = { ...safeEnvironment, HOME: home, PI_CODING_AGENT_DIR: agentDir, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"), XDG_CACHE_HOME: join(home, ".cache"), XDG_STATE_HOME: join(home, ".local/state"), TMPDIR: join(home, "tmp"), PSTACK_CONFIG: config };
  const env = { ...baseEnv, PSTACK_OMP_SMOKE_TOKEN: credential };
  await writeFile(join(agentDir, "models.yml"), `providers:\n  ${JSON.stringify(provider)}:\n    apiKey: PSTACK_OMP_SMOKE_TOKEN\n`, { mode: 0o600 });
  const overlay = join(home, "omp-smoke.yml");
  await writeFile(overlay, JSON.stringify({ task: { enableEffort: false, disabledAgents: ["designer", "librarian"], isolation: { enabled: true, apply: false, merge: "patch" } } }), { mode: 0o600 });
  const keepLine = "fixture-preserve: this unrelated setting must survive\n";
  await writeFile(config, keepLine);
  const fixture = 'export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));\n';
  await writeFile(join(project, "fixture.mjs"), fixture);
  await writeFile(join(project, "async-marker.mjs"), 'import { writeFile } from "node:fs/promises";\nawait new Promise(resolve => setTimeout(resolve, 45_000));\nawait writeFile("ASYNC_DONE", "finite-native-job-completed\\n");\nconsole.log("finite-native-job-completed");\n');
  await Promise.all([mkdir(join(project, "src")), mkdir(join(project, ".omp"))]);
  await writeFile(join(project, "src/target.txt"), "BASE\n");
  const projectConfig = join(project, ".omp/config.yml");
  await writeFile(projectConfig, `retry:\n  maxRetries: 4\ntask:\n  maxConcurrency: 4\n  agentModelOverrides:\n    comment-sicko: ${JSON.stringify(foreignSelector)}\n`);
  for (const args of [["init", "-q", "-b", "main"], ["add", "."], ["commit", "-qm", "isolated fixture"]]) {
    await execute("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=OMP smoke", "-c", "user.email=omp-smoke@example.invalid", ...args], { cwd: project, env: baseEnv, timeout: 30_000 });
  }
  await execute(bin, ["plugin", "link", candidate], { cwd: project, env: baseEnv, timeout: 60_000 });
  const plugins = JSON.parse((await execute(bin, ["plugin", "list", "--json"], { cwd: project, env: baseEnv, timeout: 30_000 })).stdout);
  const plugin = Object.values(plugins).flat().find(entry => entry.name === "pstack-pi");
  assert.equal(await realpath(plugin.path), candidate, "smoke must resolve the candidate, not an older live plugin");
  const resource = async uri => {
    assert.ok(/^skill:\/\/[a-z0-9-]+(?:\/[a-zA-Z0-9_./-]+)?$/u.test(uri), "fixture resource must be a package skill URI");
    assert.ok(!uri.split("/").some(segment => segment === "." || segment === ".."), "fixture resource must not traverse its skill boundary");
    const [name, ...parts] = uri.slice("skill://".length).split("/");
    const boundary = await realpath(join(candidate, "skills", name));
    assert.ok(boundary.startsWith(join(candidate, "skills") + sep), "resource skill root escaped the candidate");
    const target = await realpath(join(boundary, ...(parts.length ? parts : ["SKILL.md"])));
    assert.ok(target.startsWith(boundary + sep) && (await stat(target)).isFile(), "resource must resolve to a regular file inside its named skill");
    const output = (await execute(bin, ["read", uri], { cwd: project, env: baseEnv, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })).stdout;
    assert.ok(output.includes(plugin.path) || output.includes(candidate), `resource did not resolve through the candidate: ${uri}`);
    return uri;
  };
  for (const name of ["pstack-pi", "orchestrate-omp", "poteto-help"]) await resource(`skill://${name}`);
  const choose = (question, labels) => {
    let pattern, custom;
    if (/verification skill|app harness|create-verification-skill/iu.test(question)) { pattern = /^(?:no|skip|not now)\b/iu; custom = "No; do not create a verification skill for this fixture"; }
    else if (/budget|spend|cost/iu.test(question)) { pattern = /unlimited/iu; custom = "unlimited (keep current supported low reasoning)"; }
    else if (/unavailable|replacement|unsupported/iu.test(question)) { pattern = /keep|cancel|report/iu; custom = "Keep existing valid settings; report the unavailable model or unsupported reasoning without dispatch"; }
    else if (/panel|seats|runners|reviewers|judge pool/iu.test(question)) { pattern = /^(?:one|1)\b/iu; custom = `One entry only: ${selector}`; }
    else if (/model|provider|role/iu.test(question)) { pattern = new RegExp(baseSelector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"); custom = selector; }
    else if (/scope|where.*(?:save|config)|project.*global/iu.test(question)) { pattern = /project|local/iu; custom = `Project only: ${config}`; }
    else if (/save|write|config|confirm|apply|setup|proceed/iu.test(question)) { pattern = /yes|save|apply|confirm|project|custom/iu; custom = `Apply the stated fixture choices only to ${config}`; }
    else throw new Error(`Unexpected fixture question: ${question}`);
    const label = labels.find(label => pattern.test(label));
    return label ? { selectedOptions: [label] } : { selectedOptions: [], customInput: custom };
  };
  const answerUi = request => {
    if (request.secret) throw new Error("Secret UI requests are not permitted");
    if (request.method === "ask") return { answers: request.questions.map(question => ({ id: question.id, ...choose(question.question, question.options.map(option => option.label)) })) };
    const question = [request.title, request.message].filter(Boolean).join(" ");
    if (request.method === "confirm") {
      if (!/fixture|project|config|setup|save/iu.test(question)) throw new Error(`Unexpected confirmation: ${question}`);
      return { confirmed: true };
    }
    const answer = choose(question, request.options ?? []);
    return { value: answer.selectedOptions[0] ?? answer.customInput };
  };
  const sessionDir = join(root, "sessions");
  const launch = async () => {
    rpc = startOmpRpc(bin, ["--mode", "rpc-ui", "--no-ui", "--session-dir", sessionDir, "--no-extensions", "--no-rules", "--no-title", "--plugin-dir", candidate, "--model", selector, "--config", overlay], { cwd: project, env, timeoutMs: 900_000, answerUi });
    await rpc.command({ type: "set_ask_dialog", enabled: true });
    await rpc.command({ type: "set_auto_retry", enabled: false });
    await rpc.command({ type: "set_event_filter", events: null, messageUpdates: "delta" });
    await rpc.command({ type: "set_subagent_subscription", level: "progress" });
  };
  await launch();
  const catalog = (await rpc.command({ type: "get_available_commands" })).data.commands;
  const actual = catalog.filter(entry => entry.source === "skill").map(entry => entry.name.replace(/^skill:/u, "")).sort();
  const expected = (await readdir(join(candidate, "skills"), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(actual, expected);
  const initial = (await rpc.command({ type: "get_state" })).data;
  assert.equal(initial.model.provider, provider); assert.equal(initial.model.id, modelId); assert.equal(initial.thinkingLevel, thinking);
  const guard = `This is an accepted smoke in a disposable project. Use only this project's files and the candidate's skills. Do not inspect or print credentials/environment values, access outside state, contact unrelated services, install extensions, publish, push, modify global settings, or install/configure a scheduler. Do not spawn nested children. All requested models are ${selector}; use the live task schema. No Pi settings apply here. `;
  const turn = async (name, message) => {
    currentScenario = name;
    const start = rpc.frames.length;
    const result = await rpc.prompt({ type: "prompt", message: `${message}\n\n${guard}` });
    const state = (await rpc.command({ type: "get_state" })).data;
    assert.equal(state.isSettled, true, `${name} returned before native settlement`);
    assert.equal(state.hasPendingAsyncWork, false, `${name} left native async work`);
    lastText = (await rpc.command({ type: "get_last_assistant_text" })).data.text ?? "";
    const frames = rpc.frames.slice(start);
    await writeFile(join(root, `${name}.json`), redact(JSON.stringify(frames)), { mode: 0o600 });
    return { result, frames, state };
  };

  const help = await turn("help", "/skill:poteto-help Explain how to set up this candidate in OMP and start a normal pstack task. Return only JSON with setupCommand and workflowCommand as single slash-command strings that exist in the real OMP catalog, plus resources as skill:// URIs for the advised setup/runtime-loading path. Do not put prompt paragraphs in the command fields. Use OMP, not Cursor commands.");
  const advice = jsonText(lastText);
  for (const [field, skill] of [["setupCommand", "skill:setup-pstack"], ["workflowCommand", "skill:poteto-mode"]]) {
    const command = advice[field];
    const entry = catalog.find(entry => [entry.name, ...(entry.aliases ?? [])].includes(command.replace(/^\//u, "")));
    assert.equal(entry?.name, skill, `advised command does not invoke the required native skill: ${command}`);
  }
  assert.ok(advice.resources.length > 0);
  for (const uri of advice.resources) await resource(uri);
  assert.ok(toolCalls(help.frames).some(frame => toolName(frame) === "read"), "help did not load its native resources");
  scenarios.push({ name: "help", commands: [advice.setupCommand, advice.workflowCommand], resources: advice.resources });

  await rpc.command({ type: "new_session" });
  const settingsBefore = new Map(await Promise.all([join(agentDir, "config.yml"), overlay].map(async path => [path, await snapshot(path)])));
  const setup = await turn("setup", `${advice.setupCommand} Configure this OMP project. Use ${selector} for all workflow roles, one entry per panel, and unlimited budget (keep current supported reasoning). Use native ask to confirm the project save. Do not create a verification skill. Write the selected configuration and report its path.`);
  const validConfig = await readFile(config);
  assert.ok(validConfig.toString().includes(keepLine.trim()), "setup discarded an unrelated existing configuration line");
  assert.ok(validConfig.toString().includes(selector), "setup did not persist the confirmed model and supported thinking selector");
  assert.ok(setup.frames.some(frame => frame.type === "extension_ui_request" && frame.method === "ask"), "setup did not exercise native ask delivery");
  await noPi(project);
  for (const [path, before] of settingsBefore) {
    const after = await snapshot(path);
    assert.ok(before === null ? after === null : after?.equals(before), `setup wrote outside the project: ${path} changed`);
  }
  const emptyHome = join(root, "empty-home"), emptyAgentDir = join(emptyHome, ".omp/agent");
  await Promise.all([emptyAgentDir, join(emptyHome, "tmp")].map(path => mkdir(path, { recursive: true })));
  const projectEnv = { ...safeEnvironment, HOME: emptyHome, PI_CODING_AGENT_DIR: emptyAgentDir, XDG_CONFIG_HOME: join(emptyHome, ".config"), XDG_DATA_HOME: join(emptyHome, ".local/share"), XDG_CACHE_HOME: join(emptyHome, ".cache"), XDG_STATE_HOME: join(emptyHome, ".local/state"), TMPDIR: join(emptyHome, "tmp") };
  const configValue = async (key, environment) => JSON.parse((await execute(bin, ["config", "get", key, "--json"], { cwd: project, env: environment, timeout: 30_000 })).stdout).value;
  const projectValue = key => configValue(key, projectEnv);
  const overlayValue = key => configValue(key, { ...baseEnv, PI_CONFIG_FILES: overlay });
  const unpacked = JSON.parse((await execute(bin, ["agents", "unpack", "--dir", join(root, "bundled-agents"), "--json"], { cwd: project, env: baseEnv, timeout: 30_000 })).stdout);
  const bundled = unpacked.written.map(path => basename(path, ".md"));
  const liveAgents = [...bundled, ...(await readdir(join(candidate, "agents"))).filter(name => name.endsWith(".md")).map(name => basename(name, ".md"))];
  const routes = await projectValue("task.agentModelOverrides");
  assert.equal(await projectValue("retry.maxRetries"), 4, "setup discarded an unrelated project key");
  assert.equal(await projectValue("task.maxConcurrency"), 4, "setup discarded an unrelated task key");
  assert.equal(routes["comment-sicko"], foreignSelector, "setup rewrote an override for an agent it does not own");
  for (const agent of bundled.filter(name => name !== "seance")) assert.equal(routes[agent], selector, `setup did not route ${agent} to the confirmed selector`);
  assert.equal(routes.seance, undefined, "setup must not route the seance consult agent");
  for (const name of Object.keys(routes)) assert.ok(liveAgents.includes(name), `setup wrote an override for a non-live agent: ${name}`);
  assert.equal(await overlayValue("task.isolation.apply"), false, "isolation auto-apply must be disabled for the isolation proof");
  await rpc.close();
  await launch();
  scenarios.push({ name: "setup", unrelatedLinePreserved: true, nativeAsk: true, piSettingsAbsent: true, projectOnlyWrites: true, routedAgents: bundled.filter(name => name !== "seance"), foreignRoutePreserved: true });

  await rpc.command({ type: "new_session" });
  await writeFile(config, `${validConfig.toString()}\nfeature, refactoring reasoning: fixture-unsupported\n`);
  const invalidSeed = await readFile(config);
  const unavailable = `${provider}/fixture-unavailable-model`;
  const routedSeed = await readFile(projectConfig);
  const rejected = await turn("invalid-choices", `/skill:setup-pstack Check the saved fixture-unsupported reasoning entry and requested model ${unavailable}. Neither is valid. Report both rejected choices; do not dispatch a child, substitute a model, or modify the existing configuration. Then verify that ${selector} remains a supported thinking selector even though the task effort field is absent. Return only JSON whose rejectedModel, rejectedReasoning, and supportedSelector fields are those exact strings, or objects whose value is that string.`);
  const rejection = jsonText(lastText);
  assert.equal(reported(rejection.rejectedModel), unavailable); assert.equal(reported(rejection.rejectedReasoning), "fixture-unsupported"); assert.equal(reported(rejection.supportedSelector), selector);
  assert.ok(!toolCalls(rejected.frames).some(frame => toolName(frame) === "task"), "invalid choices reached task dispatch");
  assert.ok((await readFile(config)).equals(invalidSeed), "rejected choices modified existing settings");
  assert.ok((await readFile(projectConfig)).equals(routedSeed), "rejected choices modified project routing");
  await rpc.command({ type: "set_thinking_level", level: thinking });
  const reasoningState = (await rpc.command({ type: "get_state" })).data;
  assert.equal(reasoningState.thinkingLevel, thinking);
  await writeFile(config, validConfig);
  await noPi(project);
  scenarios.push({ name: "invalid-choices", noInvalidDispatch: true, settingsPreserved: true, supportedThinkingApplied: thinking });

  await rpc.command({ type: "new_session" });
  const workflow = await turn("workflow", `${advice.workflowCommand} Investigate fixture.mjs without editing it. Use canonical planner and researcher roles, mapped through pstack-pi to the available native agents; designer and librarian are disabled. Start independent planning/research together with standalone briefs and ${selector}. The planner must report PLAN_NATIVE_PROOF and the researcher RESEARCH_NATIVE_PROOF plus the actual results of clamp(-2,0,5) and clamp(9,0,5). Read each full child result through its native agent resource, not a preview. Return only JSON with lower: 0, upper: 5, and consumedReports listing both proof markers.`);
  const tasks = toolCalls(workflow.frames).filter(frame => toolName(frame) === "task");
  assert.ok(tasks.length > 0, "workflow did not invoke native task");
  const participants = tasks.flatMap(frame => frame.args?.tasks ?? [frame.args]);
  assert.ok(participants.length >= 2, "workflow omitted the independent planner/research coverage");
  for (const participant of participants) {
    assert.ok(!["designer", "librarian"].includes(participant.agent), "disabled agent reached dispatch");
    assert.ok(participant.effort === undefined, "hidden effort field reached dispatch");
  }
  const spawned = workflow.frames.filter(frame => frame.type === "subagent_lifecycle" && frame.payload?.status === "started").map(frame => frame.payload.id);
  assert.ok(spawned.length >= 2, "workflow spawned fewer than two children");
  const workflowChildren = new Map((await childJournals(workflow.state.sessionFile)).map(child => [child.id, child]));
  const agentReads = pairedCalls(workflow.frames, "read");
  const producers = marker => spawned.filter(spawnedId => workflowChildren.has(spawnedId)
    && agentReads.some(call => [`agent://${spawnedId}`, `agent://${spawnedId}:raw`].includes(call.args?.path) && resultIncludes(call, marker))
    && findReply(workflowChildren.get(spawnedId).journal, marker));
  const plan = producers("PLAN_NATIVE_PROOF"), research = producers("RESEARCH_NATIVE_PROOF");
  const [planner, researcher] = plan.flatMap(first => research.filter(second => second !== first).map(second => [first, second]))[0] ?? [];
  assert.ok(planner && researcher, `PLAN_NATIVE_PROOF (children: ${plan.join(", ") || "none"}) and RESEARCH_NATIVE_PROOF (children: ${research.join(", ") || "none"}) were not each produced in a journal bound to this parent, and read from that child's own agent:// result, by two different children`);
  const report = jsonText(lastText);
  assert.equal(report.lower, 0); assert.equal(report.upper, 5);
  assert.deepEqual([...report.consumedReports].sort(), ["PLAN_NATIVE_PROOF", "RESEARCH_NATIVE_PROOF"].sort());
  assert.equal(await readFile(join(project, "fixture.mjs"), "utf8"), fixture);
  scenarios.push({ name: "workflow", participants: participants.map(item => ({ name: item.name, agent: item.agent ?? "default (omitted)" })), proofChildren: { planner, researcher }, lower: report.lower, upper: report.upper });

  await rpc.command({ type: "new_session" });
  await rpc.command({ type: "set_model", provider, modelId: alternate.id });
  const nonce = randomUUID().slice(0, 8);
  const routing = await turn("routing", `Use the native task tool once with the default task agent and no model field; routing comes from project configuration. The child must reply exactly ROUTE_${nonce} and yield. Return only JSON {"marker": "ROUTE_${nonce}"}.`);
  assert.equal(reported(jsonText(lastText).marker), `ROUTE_${nonce}`);
  const routingParent = routing.state.sessionFile;
  assert.ok(routingParent, "persisted parent session file is required for provenance");
  const parentSummary = summarize(parseJournal(await readFile(routingParent, "utf8"), routingParent));
  assert.deepEqual(parentSummary.invoked, [`${provider}/${alternate.id}`], "the routing parent must run only on its own, different model");
  const routed = (await childJournals(routingParent)).filter(child => child.agent === "task");
  assert.ok(routed.length > 0, "no persisted task child journal is bound to the routing parent");
  const expectedResolved = thinking === "off" ? [baseSelector, `${baseSelector}:off`] : [selector];
  for (const child of routed) {
    assertInvokedOnly(child, baseSelector, child.id);
    assert.ok(expectedResolved.includes(child.resolvedSelector), `${child.id} resolved ${child.resolvedSelector ?? "no selector"}, expected ${expectedResolved.join(" or ")}`);
  }
  const outputs = await Promise.all(routed.map(async child => ({ child, output: await snapshot(join(routingParent.slice(0, -".jsonl".length), `${child.id}.md`)) })));
  assert.ok(outputs.some(({ child, output }) => output?.toString().includes(`ROUTE_${nonce}`) && findReply(child.journal, `ROUTE_${nonce}`)), `no routed child replied ROUTE_${nonce} in both its journal and its saved output`);
  scenarios.push({ name: "routing", parentInvoked: parentSummary.invoked, children: routed.map(child => ({ id: child.id, attempts: child.attempts, resolvedSelector: child.resolvedSelector, resolved: child.resolved, auxiliary: child.auxiliary })) });

  await rpc.command({ type: "new_session" });
  const git = async args => (await execute("git", args, { cwd: project, env: baseEnv, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const fingerprint = async () => {
    const hash = createHash("sha256");
    for (const args of [["rev-parse", "HEAD"], ["status", "--porcelain", "--untracked-files=all"], ["diff", "HEAD", "--binary"]]) hash.update(await git(args)).update("\0");
    for (const path of (await git(["ls-files", "-o", "--exclude-standard", "-z"])).split("\0").filter(Boolean).sort()) hash.update(`${path}\0`).update(await readFile(join(project, path)));
    return hash.digest("hex");
  };
  const parentBefore = await fingerprint();
  const isolation = await turn("isolation", `Use the native task tool once with isolated: true. The child must run pwd and git rev-parse --show-toplevel, overwrite the relative path src/target.txt with exactly ISOLATED_EDIT, then yield. Do not apply, merge, or edit src/target.txt yourself.`);
  assert.ok(toolCalls(isolation.frames).filter(frame => toolName(frame) === "task").some(frame => (frame.args?.tasks ?? [frame.args]).some(item => item.isolated === true)), "isolation turn did not request native isolation");
  const realProject = await realpath(project);
  const roots = (await childJournals(isolation.state.sessionFile)).filter(child => child.cwd !== project && child.cwd !== realProject);
  assert.ok(roots.length > 0, "no bound child ran in a separate root");
  const patches = await Promise.all(roots.map(child => snapshot(join(isolation.state.sessionFile.slice(0, -".jsonl".length), `${child.id}.patch`))));
  assert.ok(patches.some(patch => patch?.toString().includes("ISOLATED_EDIT") && patch.toString().includes("src/target.txt")), "relative write was not captured in an isolated patch");
  assert.equal(await readFile(join(project, "src/target.txt"), "utf8"), "BASE\n", "isolated child modified the parent");
  assert.equal(await fingerprint(), parentBefore, "parent HEAD, tracked diff, or untracked content changed");
  scenarios.push({ name: "isolation", separateRoots: roots.map(child => child.cwd), patchCaptured: true, parentUnchanged: true, autoApply: false });

  await rpc.command({ type: "new_session" });
  const first = `CHILD_${nonce}`, followup = `FOLLOWUP_${nonce}`;
  const peer = await turn("subagent-lifecycle", `/skill:pstack-pi Use the native task tool once with the default task agent; the child must reply exactly ${first} and yield. Await completion and read the published first result through agent://<id> before sending a follow-up; a running-progress read is not the result. Then send that same child a direct follow-up with write to agent://<id> asking it to reply exactly ${followup}, and wait for the reply. Then read history://<id> to confirm the reply. Return only JSON {"first": "${first}", "followup": "${followup}"}.`);
  const lifecycleFrames = peer.frames.filter(frame => frame.type === "subagent_lifecycle").map(frame => frame.payload);
  const child = lifecycleFrames.find(payload => payload.status === "started");
  assert.ok(child?.id && lifecycleFrames.some(payload => payload.id === child.id && payload.status === "completed"), "no started and completed lifecycle for one child");
  const answer = jsonText(lastText);
  assert.equal(reported(answer.first), first); assert.equal(reported(answer.followup), followup);
  const [bound] = (await childJournals(peer.state.sessionFile)).filter(journal => journal.id === child.id);
  assert.ok(bound, "child journal is not bound to its parent");
  assert.ok(findReply(bound.journal, first), `child never produced ${first} in a completed assistant output`);
  const target = `agent://${child.id}`;
  const firstRead = pairedCalls(peer.frames, "read").find(call => [target, `${target}:raw`].includes(call.args?.path) && resultIncludes(call, first));
  assert.ok(firstRead, "parent did not read the child's first result through its agent:// resource");
  const sent = pairedCalls(peer.frames, "write").find(call => call.args?.path === target && String(call.args?.content).includes(followup) && completed(call));
  assert.ok(sent, "parent's direct follow-up write to the child did not complete");
  assert.ok(sent.index > firstRead.endIndex, "the follow-up was sent before the first result was read");
  assert.ok(findReply(bound.journal, followup, followup), `child never answered the follow-up with ${followup} after receiving it`);
  const history = pairedCalls(peer.frames, "read").find(call => String(call.args?.path).startsWith(`history://${child.id}`) && call.index > sent.endIndex && completed(call) && historyShowsReply(resultText(call), followup, followup));
  assert.ok(history, "no history read after the follow-up shows the child's reply after the request");
  scenarios.push({ name: "subagent-lifecycle", child: child.id, startedCompleted: true, firstReplyInJournal: true, followupAnsweredInJournal: true, historyShowsReply: true });

  await rpc.command({ type: "new_session" });
  const lifecycle = await turn("lifecycle", `/skill:pstack-pi Launch node async-marker.mjs using the live native bash async facility, not a shell background process. After launching, write the manual checkpoint and stop that turn so the host can yield while the finite job is still pending. Do not wait, poll, sleep, or inspect ASYNC_DONE in the launch turn. Consume the native delivery on the follow-up wake, then inspect ASYNC_DONE. An hourly audit was requested, but this fixture has no scheduler capability: do not install or promise one. Record a manual checkpoint at .pstack/hourly-audit.md with the next exact command and note that an agent id is only a handle owned by its session: the owning live session can message an idle or parked agent with write agent://<id>, but the id alone does not restart a session after that process exits. Finish only when the finite job and checkpoint are complete.`);
  assert.equal(await readFile(join(project, "ASYNC_DONE"), "utf8"), "finite-native-job-completed\n");
  const asyncCalls = toolCalls(lifecycle.frames).filter(frame => toolName(frame) === "bash" && frame.args?.async === true && frame.args?.command?.includes("async-marker.mjs"));
  assert.ok(asyncCalls.length > 0, "lifecycle did not launch the finite fixture through native asynchronous bash");
  assert.ok(lifecycle.frames.some(frame => frame.type === "prompt_result" && frame.sessionSettled === false), "finite asynchronous work did not exercise yield before settlement");
  assert.ok(lifecycle.frames.some(frame => frame.type === "session_settled"), "native session never settled after async delivery");
  assert.ok((await readFile(join(project, ".pstack/hourly-audit.md"), "utf8")).includes("async-marker.mjs"), "checkpoint omitted the exact resumable command");
  await noPi(project);
  scenarios.push({ name: "lifecycle", nativeAsync: true, yieldThenSettled: true, markerObserved: true, manualCheckpoint: true });

  await rpc.close();
  const manifest = JSON.parse(await readFile(join(candidate, "package.json")));
  const lock = JSON.parse(await readFile(join(candidate, "upstream.lock.json")));
  const summary = { runtime: (await execute(bin, ["--version"], { timeout: 30_000 })).stdout.trim(), source: candidate, forkVersion: manifest.version, sourceCommit: lock.commit, sourceVersion: lock.version, model: baseSelector, thinkingLevel: thinking, configuredTaskEffort: false, skillCount: actual.length, scenarios };
  await writeFile(join(root, "summary.json"), redact(JSON.stringify(summary)), { mode: 0o600 });
  console.log(redact(JSON.stringify(summary)));
} catch (error) {
  const calls = rpc ? toolCalls(rpc.frames).map(frame => ({ name: frame.toolName, args: frame.args })) : [];
  const promptResults = rpc ? rpc.frames.filter(frame => frame.type === "prompt_result").map(frame => ({ id: frame.id, status: frame.status, sessionSettled: frame.sessionSettled, agentInvoked: frame.agentInvoked })) : [];
  console.error(redact(JSON.stringify({ scenario: currentScenario, error: error.message, nativeError: error.cause?.error, completed: scenarios, promptResults, toolCalls: calls, lastAssistantText: lastText, retainedWorkspace: root })));
  process.exitCode = 1;
} finally {
  try {
    await rpc?.close();
    for (const [path, bytes] of liveSnapshots) {
      const current = await snapshot(path);
      assert.ok(bytes === null ? current === null : current?.equals(bytes), `live configuration changed: ${path}`);
    }
  } catch (restoreError) {
    process.exitCode = 1;
    console.error(redact(JSON.stringify({ error: restoreError.message, retainedWorkspace: root })));
  } finally {
    if (process.exitCode) {
      console.error(`retained workspace: ${root}`);
    } else {
      await rm(root, { recursive: true, force: true });
    }
  }
}

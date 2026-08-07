// The chat view — the first UI module split out of ui.js, as the 3b plan
// required (the bundle was 2,700 lines inside one template literal with a
// known backtick trap; growing it another 300 in place was the wrong answer).
//
// SAME RULES AS THE CORE BUNDLE, because this string ships into the same
// browser page: no backticks and no ${} inside the template (the module-scope
// evaluation trap), textContent everywhere and never innerHTML (a model's
// output is untrusted content in a token-holding page — the CSP is the
// backstop, not the defence), fetch only to same-origin paths, no sockets.
// The composed-bundle guards in test/package.test.js scan the SERVED string,
// so everything asserted about ui.js binds this file identically.
//
// MEASUREMENT RENDERING: the strip under each reply draws exactly what the
// server's derive layer concluded — value-or-reason pairs — and invents
// nothing. An unavailable figure renders as its reason, never as zero, and
// utilization arrives only when a sourced ceiling existed server-side.

export const CHAT_JS = `
// ---------------------------------------------------------------------------
// Chat — the inference surface, measurement-first.
// ---------------------------------------------------------------------------

var chatConversations = [];
var chatActiveId = null;
var chatEvents = [];
var chatStrips = [];
var chatExpectations = [];
// Baselines are LIVE-SESSION data: each send's envelope carries the standing
// best at the moment the reply began. History reloads leave gaps (undefined),
// because a baseline-as-it-was is not reconstructed after the fact.
var chatBaselines = [];
var chatPhysics = null;
var chatStreaming = false;
var chatAbort = null;
var chatNotice = null;
// The chosen model survives re-renders. Without this, every refresh reset the
// select to its first option — found in browser verification when a
// continuation send silently went to a different model, visible ONLY because
// the strip's ceiling changed with it. The instrument caught its own UI bug.
// Holds the option KEY ("<runtime> <name>"), not a bare name, because two
// runtimes can serve the same model name.
var chatSelectedModel = null;
// What /api/chat/models reported about the second runtime: null until fetched,
// then { configured, available, reason, models }. Rendered honestly in all
// three states — absent, unreachable-with-reason, or listed.
var chatOpenAiRuntime = null;
// Option key → { runtime, model }, rebuilt each composer render. The select's
// value alone cannot carry both fields without string-parsing model names,
// which may themselves contain any separator we could pick.
var chatModelIndex = new Map();
// The requested context window (num_ctx), persisted across re-renders like
// the model choice. Empty means default conditions — nothing is sent.
var chatNumCtx = "";
// System prompt: the DRAFT is composed before a conversation exists; the
// ACTIVE one is whatever the open conversation was created with — set at
// start, never changed mid-way, because the replies already made were shaped
// by the prompt that stood when they happened.
var chatSystemPromptDraft = "";
var chatSystemPromptActive = null;
// Search over the user's own conversations: the query text and, when a
// search ran, its result payload ({results, truncated}); null shows the list.
var chatSearchQuery = "";
var chatSearchResults = null;

function refreshChat() {
  if (activeView === "chat" && dashboardData) renderView("chat");
}

function stripFigure(figure, unit, digits) {
  if (!figure || figure.available !== true) return null;
  return Number(figure.value).toFixed(digits) + unit;
}

// One line of honest figures under a reply. Only available figures render;
// what could not be measured is summarised at the end rather than padding the
// line with reasons — the full reason is in the title attribute.
function chatStripLine(strip, baseline) {
  const row = el("div", "chat-strip");
  const parts = [];
  const add = (label, text, title) => {
    if (text === null) return;
    const span = el("span", null, label ? label + " " + text : text);
    if (title) span.title = title;
    parts.push(span);
  };
  add("", stripFigure(strip.generation, " tok/s", 2));
  if (strip.utilization && strip.utilization.available) {
    // A manual ceiling is labelled IN the figure, not only in a tooltip — a
    // percentage against a user-entered number must never render
    // indistinguishably from one against a manufacturer-sourced figure.
    const manualCeiling = strip.utilization.ceilingSource === "manual";
    add("", (strip.utilization.value * 100).toFixed(1) + "% of " + (manualCeiling ? "manual ceiling" : "ceiling"),
      manualCeiling
        ? "observed generation rate against the bandwidth figure YOU entered in the Hardware view - not manufacturer-sourced"
        : "observed generation rate against this machine's manufacturer-sourced memory-bandwidth ceiling for this model");
  }
  add("first token", stripFigure(strip.timeToFirstTokenMs, " ms", 0));
  if (strip.coldLoad && strip.coldLoad.includedColdLoad === true) {
    add("", "included cold load (" + strip.coldLoad.value.toFixed(1) + " s)");
  }
  // A non-default context window is a run condition; the strip says so.
  if (strip.requestedNumCtx) {
    add("", "ctx " + strip.requestedNumCtx,
      "this reply was requested with num_ctx=" + strip.requestedNumCtx + " - a non-default context window changes KV size and speed");
  }
  // This machine's own best for this model, environment-gated server-side —
  // the founding example's actual comparison. A new best is worth its accent.
  if (baseline && baseline.available && !baseline.isFirst) {
    const span = el("span", baseline.isNewBest ? null : "chat-strip-muted", baseline.note);
    span.title = "Compared only against replies recorded under the same declared run conditions (matching environment hash).";
    parts.push(span);
  }
  const unavailable = ["generation", "utilization", "timeToFirstTokenMs"]
    .filter(function (k) { return strip[k] && strip[k].available === false; });
  if (parts.length === 0) {
    const why = unavailable.map(function (k) { return strip[k].reason; }).join("; ");
    parts.push(el("span", null, "not measured" + (why ? " — " + why : "")));
  } else if (unavailable.length) {
    const span = el("span", "chat-strip-muted", unavailable.length + " unavailable");
    span.title = unavailable.map(function (k) { return k + ": " + strip[k].reason; }).join("; ");
    parts.push(span);
  }
  for (const part of parts) row.append(part);
  return row;
}

// The expectation line: what the fit engine predicted beside what the machine
// did. Quiet when the promise was kept, warn-colored when it was broken —
// disagreement between prediction and observation is the product's founding
// reason to exist, and it must not whisper.
function chatExpectationLine(expectation) {
  if (!expectation || expectation.available !== true || expectation.verdict === "unknown") return null;
  const cls = expectation.verdict === "disagrees" ? "chat-expect disagrees" : "chat-expect";
  const row = el("div", cls);
  row.append(el("span", "chat-expect-verdict", expectation.verdict === "disagrees" ? "prediction broken" : "as predicted"));
  row.append(el("span", null, expectation.note));
  return row;
}

// The conversation's own trend, spill distinguished from physics — rendered
// once above the messages when there is enough history to say anything.
function chatPhysicsLine() {
  if (!chatPhysics || chatPhysics.available !== true) return null;
  const row = el("div", "chat-physics" + (chatPhysics.spillSuspected ? " disagrees" : ""));
  row.append(el("span", null, chatPhysics.note));
  return row;
}

async function chatRefreshConversations() {
  try {
    const res = await fetch("/api/chat/conversations", { headers: { "x-cmdcenter-token": TOKEN } });
    const body = await res.json();
    chatConversations = body.ok === false ? [] : body.conversations || [];
    chatNotice = body.ok === false ? body.reason : chatNotice;
  } catch (err) {
    chatNotice = String(err.message);
  }
}

async function chatRefreshRuntimes() {
  try {
    const res = await fetch("/api/chat/models", { headers: { "x-cmdcenter-token": TOKEN } });
    const body = await res.json();
    chatOpenAiRuntime = body.ok === false ? null : body.openaiCompat || null;
  } catch (err) {
    chatOpenAiRuntime = null;
  }
}

async function chatOpen(id) {
  try {
    const res = await fetch("/api/chat/history", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({ id: id }),
    });
    const body = await res.json();
    if (!body.ok) { chatNotice = body.reason; refreshChat(); return; }
    chatActiveId = id;
    chatEvents = body.events;
    chatStrips = body.strips || [];
    chatExpectations = body.expectations || [];
    chatBaselines = new Array((body.strips || []).length);
    chatPhysics = body.physics || null;
    chatSystemPromptActive = body.header ? body.header.systemPrompt : null;
    chatNotice = null;
  } catch (err) {
    chatNotice = String(err.message);
  }
  refreshChat();
}

function chatNew() {
  chatActiveId = null;
  chatEvents = [];
  chatStrips = [];
  chatExpectations = [];
  chatBaselines = [];
  chatPhysics = null;
  chatSystemPromptActive = null;
  chatSystemPromptDraft = "";
  chatNotice = null;
  refreshChat();
}

async function chatDelete(id) {
  // The delete-with-confirm control the storage decision promised: the
  // conversation's words are the only copy, and there is no undo.
  if (!window.confirm("Delete this conversation? Its messages are removed permanently. Measurement history (numbers only) is kept.")) return;
  try {
    const res = await fetch("/api/chat/delete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({ id: id }),
    });
    const body = await res.json();
    if (!body.ok) chatNotice = body.reason;
    if (chatActiveId === id) chatNew();
  } catch (err) {
    chatNotice = String(err.message);
  }
  await chatRefreshConversations();
  refreshChat();
}

async function chatSend(runtime, model, text, numCtx, systemPrompt) {
  if (chatStreaming || !text.trim()) return;
  chatStreaming = true;
  chatNotice = null;
  chatEvents.push({ type: "user", at: null, text: text });
  chatEvents.push({ type: "assistant", at: null, text: "", thinking: null, model: model, streamingNow: true });
  refreshChat();

  const live = chatEvents[chatEvents.length - 1];
  const controller = new AbortController();
  chatAbort = controller;
  try {
    const res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({
        conversationId: chatActiveId,
        runtime: runtime,
        model: model,
        text: text,
        numCtx: numCtx === undefined ? null : numCtx,
        systemPrompt: systemPrompt === undefined ? null : systemPrompt,
      }),
      signal: controller.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    var buffer = "";
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      const lines = buffer.split("\\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.refused) { chatNotice = "Refused: " + chunk.refused; live.failed = true; continue; }
        if (chunk.message) {
          if (chunk.message.content) live.text += chunk.message.content;
          if (chunk.message.thinking) live.thinking = (live.thinking || "") + chunk.message.thinking;
          chatStreamPaint(live);
        }
        if (chunk.done === true && chunk.conversationId) {
          if (chatActiveId === null && systemPrompt) chatSystemPromptActive = systemPrompt;
          chatActiveId = chunk.conversationId;
          live.stopped = chunk.stopped === true;
          if (chunk.failure) chatNotice = chunk.failure;
          if (chunk.conversationPersisted === false || chunk.measurementRecorded === false) {
            chatNotice = "the reply happened but saving it " +
              (chunk.conversationPersisted === false ? "to the conversation " : "to measurement history ") + "failed";
          }
          if (chunk.strip) chatStrips.push(chunk.strip);
          if (chunk.expectation) chatExpectations.push(chunk.expectation);
          if (chunk.baseline) chatBaselines[chatStrips.length - 1] = chunk.baseline;
          if (chunk.physics) chatPhysics = chunk.physics;
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") chatNotice = String(err.message);
    live.stopped = true;
  }
  live.streamingNow = false;
  chatStreaming = false;
  chatAbort = null;
  await chatRefreshConversations();
  refreshChat();
}

// Paint the live bubble in place while streaming — a full re-render per chunk
// would fight the input focus and the scroll position.
function chatStreamPaint(live) {
  const bubble = document.getElementById("chat-live-bubble");
  if (bubble) bubble.textContent = live.text.length ? live.text : "…";
  const thinking = document.getElementById("chat-live-thinking");
  if (thinking && live.thinking) {
    thinking.textContent = live.thinking;
    thinking.hidden = false;
  }
  const pane = document.getElementById("chat-messages");
  if (pane) pane.scrollTop = pane.scrollHeight;
}

// The strip as text, for export — the same figures the strip renders, with
// the same provenance labels ("manual ceiling" stays labelled on paper too).
function chatStripText(strip) {
  const parts = [];
  const gen = stripFigure(strip.generation, " tok/s", 2);
  if (gen) parts.push(gen);
  if (strip.utilization && strip.utilization.available) {
    parts.push((strip.utilization.value * 100).toFixed(1) + "% of " +
      (strip.utilization.ceilingSource === "manual" ? "manual ceiling" : "ceiling"));
  }
  const ttft = stripFigure(strip.timeToFirstTokenMs, " ms", 0);
  if (ttft) parts.push("first token " + ttft);
  if (strip.coldLoad && strip.coldLoad.includedColdLoad === true) {
    parts.push("included cold load (" + strip.coldLoad.value.toFixed(1) + " s)");
  }
  if (strip.requestedNumCtx) parts.push("ctx " + strip.requestedNumCtx + " requested");
  return parts.join(" · ");
}

// Export the open conversation as markdown, WITH its measurements — the
// figures are the reason this chat surface exists, and an export without
// them would be any other chat log. Entirely client-side: a file download
// the user initiates, onto their own disk; no new server surface.
function chatExport() {
  if (!chatActiveId || !chatEvents.length) return;
  const lines = [];
  lines.push("# Conversation " + chatActiveId.slice(0, 12) + " — OpenSourcesAI Command Center");
  lines.push("");
  lines.push("Exported " + new Date().toLocaleString() +
    ". Figures are in-situ measurements from this machine, not protocol-grade benchmarks.");
  if (chatSystemPromptActive) {
    lines.push("");
    lines.push("**System prompt:** " + chatSystemPromptActive);
  }
  var stripIndex = 0;
  chatEvents.forEach(function (event) {
    lines.push("");
    if (event.type === "user") {
      lines.push("## User" + (event.at ? " (" + event.at + ")" : ""));
      lines.push("");
      lines.push(event.text);
      return;
    }
    lines.push("## " + (event.model || "Assistant") + (event.at ? " (" + event.at + ")" : ""));
    if (event.thinking) {
      lines.push("");
      lines.push("*(thinking)* " + event.thinking.split("\\n").join("\\n> "));
    }
    lines.push("");
    lines.push(event.text);
    if (event.stopped) { lines.push(""); lines.push("*stopped before completion*"); }
    if (!event.failed && chatStrips[stripIndex]) {
      const text = chatStripText(chatStrips[stripIndex]);
      if (text) { lines.push(""); lines.push("> measured: " + text); }
      const expectation = chatExpectations[stripIndex];
      if (expectation && expectation.available && expectation.verdict === "disagrees") {
        lines.push("> prediction broken: " + expectation.note);
      }
    }
    if (!event.failed) stripIndex += 1;
  });
  if (chatPhysics && chatPhysics.available) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("Conversation trend: " + chatPhysics.note);
  }
  const blob = new Blob([lines.join("\\n") + "\\n"], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url;
  a.download = "osai-conversation-" + chatActiveId.slice(0, 12) + ".md";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function chatModelLabel(entry, loadedMap) {
  var label = entry.name;
  if (entry.grade && entry.grade.fit) label += " · " + entry.grade.fit.replace("_", " ");
  const resident = loadedMap.get(entry.name);
  if (resident) label += " · resident " + resident.vramResidentPercent + "%";
  return label;
}

async function chatRunSearch() {
  if (!chatSearchQuery.trim()) { chatSearchResults = null; refreshChat(); return; }
  try {
    const res = await fetch("/api/chat/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({ query: chatSearchQuery }),
    });
    const body = await res.json();
    chatSearchResults = body.ok === false ? { results: [], truncated: false, error: body.reason } : body;
  } catch (err) {
    chatSearchResults = { results: [], truncated: false, error: String(err.message) };
  }
  refreshChat();
}

function chatSidebar() {
  const side = el("div", "chat-side");
  const fresh = el("button", null, "New conversation");
  fresh.type = "button";
  fresh.addEventListener("click", chatNew);
  side.append(fresh);

  // Search over the words in the user's own conversations. Enter runs it;
  // clearing the box returns to the plain list.
  const search = el("input", "chat-search");
  search.type = "search";
  search.placeholder = "Search conversations…";
  search.setAttribute("aria-label", "Search conversations");
  search.value = chatSearchQuery;
  search.addEventListener("input", function () {
    chatSearchQuery = search.value;
    if (search.value.trim() === "" && chatSearchResults) { chatSearchResults = null; refreshChat(); }
  });
  search.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); chatRunSearch(); }
  });
  side.append(search);

  const list = el("div", "chat-list");
  if (chatSearchResults) {
    if (chatSearchResults.error) list.append(el("p", "bench-error", chatSearchResults.error));
    else if (!chatSearchResults.results.length) list.append(el("p", "bench-note", "No matches."));
    for (const hit of chatSearchResults.results || []) {
      const row = el("div", "chat-list-row" + (hit.id === chatActiveId ? " active" : ""));
      const open = el("button", "chat-list-open", (hit.model || hit.id) + " · " + hit.matches.length + " match(es)");
      open.type = "button";
      open.title = hit.matches[0] ? hit.matches[0].snippet : hit.id;
      open.addEventListener("click", function () { chatOpen(hit.id); });
      row.append(open);
      list.append(row);
      const snip = el("p", "chat-snippet", hit.matches[0] ? hit.matches[0].snippet : "");
      list.append(snip);
    }
    if (chatSearchResults.truncated) {
      list.append(el("p", "bench-note", "More matches exist — this shows the first 50."));
    }
  } else {
    for (const convo of chatConversations) {
      const row = el("div", "chat-list-row" + (convo.id === chatActiveId ? " active" : ""));
      const open = el("button", "chat-list-open", (convo.model || convo.id) + " · " + (convo.messageCount ?? "?") + " msg");
      open.type = "button";
      open.title = convo.lastAt ? new Date(convo.lastAt).toLocaleString() : convo.id;
      open.addEventListener("click", function () { chatOpen(convo.id); });
      const del = el("button", "icon-button", "✕");
      del.type = "button";
      del.setAttribute("aria-label", "Delete conversation");
      del.addEventListener("click", function () { chatDelete(convo.id); });
      row.append(open, del);
      list.append(row);
    }
    if (!chatConversations.length) list.append(el("p", "bench-note", "No saved conversations."));
  }
  side.append(list);
  return side;
}

function chatMessages() {
  const pane = el("div", "chat-messages");
  pane.id = "chat-messages";
  var stripIndex = 0;
  chatEvents.forEach(function (event, index) {
    const isLast = index === chatEvents.length - 1;
    const bubble = el("div", "chat-msg " + (event.type === "user" ? "from-user" : "from-model"));
    if (event.type === "assistant") {
      const thinking = el("div", "chat-thinking", event.thinking || "");
      thinking.hidden = !event.thinking;
      if (isLast && event.streamingNow) thinking.id = "chat-live-thinking";
      bubble.append(thinking);
      const text = el("div", null, event.text.length ? event.text : (event.streamingNow ? "…" : ""));
      if (isLast && event.streamingNow) text.id = "chat-live-bubble";
      bubble.append(text);
      if (event.stopped) bubble.append(el("div", "chat-strip-muted", "stopped before completion"));
      if (!event.streamingNow && !event.failed && chatStrips[stripIndex]) {
        bubble.append(chatStripLine(chatStrips[stripIndex], chatBaselines[stripIndex]));
        const expectation = chatExpectationLine(chatExpectations[stripIndex]);
        if (expectation) bubble.append(expectation);
      }
      if (!event.streamingNow && !event.failed) stripIndex += 1;
    } else {
      bubble.append(el("div", null, event.text));
    }
    pane.append(bubble);
  });
  if (!chatEvents.length) {
    pane.append(el("p", "bench-note", "Every reply arrives with its own measurements: tokens per second against this machine's ceiling, first-token time, residency. Same rules as everywhere else — unavailable is never zero."));
  }
  return pane;
}

function chatComposer(d) {
  const wrap = el("div", "chat-composer");
  // The system prompt is composable only BEFORE the conversation exists —
  // set at start, shown read-only after (see chatView's header line).
  if (chatActiveId === null) {
    const sys = el("textarea", "chat-system");
    sys.rows = 2;
    sys.placeholder = "System prompt (optional) — set when the conversation starts, fixed afterwards";
    sys.setAttribute("aria-label", "System prompt for the new conversation");
    sys.value = chatSystemPromptDraft;
    sys.addEventListener("input", function () { chatSystemPromptDraft = sys.value; });
    wrap.append(sys);
  }
  const select = el("select");
  select.id = "chat-model";
  select.setAttribute("aria-label", "Model");
  const loadedMap = loadedModelMap(lastLive);
  chatModelIndex = new Map();
  const addOption = function (runtime, name, label) {
    const key = runtime + " " + name;
    chatModelIndex.set(key, { runtime: runtime, model: name });
    const option = el("option", null, label);
    option.value = key;
    select.append(option);
  };
  const runnable = d.installed.filter(function (i) { return !i.grade || i.grade.fit !== "too_large"; });
  for (const entry of (runnable.length ? runnable : d.installed)) {
    addOption("ollama", entry.name, chatModelLabel(entry, loadedMap));
  }
  // The second runtime's models, labelled by origin. No grade and no residency
  // annotation: the fit engine graded the OLLAMA artifacts, and this protocol
  // has no residency probe — an unlabelled figure would be a borrowed one.
  if (chatOpenAiRuntime && chatOpenAiRuntime.available) {
    for (const name of chatOpenAiRuntime.models) {
      addOption("openai-compat", name, name + " · llama.cpp");
    }
  }
  if (chatSelectedModel && [...select.options].some(function (o) { return o.value === chatSelectedModel; })) {
    select.value = chatSelectedModel;
  }
  select.addEventListener("change", function () { chatSelectedModel = select.value; });
  const input = el("textarea", "chat-input");
  input.id = "chat-input";
  input.rows = 3;
  input.placeholder = "Message the model on this machine…";
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go.click(); }
  });
  // The first parameter control: a context window in tokens. Empty means
  // default conditions; a value is sent, applied, AND recorded — the strip
  // under the reply names it, because it changes KV size and speed.
  const ctx = el("input", "chat-ctx");
  ctx.type = "number";
  ctx.min = "128";
  ctx.max = "1048576";
  ctx.step = "1";
  ctx.placeholder = "ctx (default)";
  ctx.title = "Requested context window (num_ctx), in tokens. Leave empty for the runtime default. Recorded with the reply's measurements. Ollama only - llama.cpp sets its window at server launch.";
  ctx.setAttribute("aria-label", "Requested context window in tokens");
  ctx.value = chatNumCtx;
  ctx.addEventListener("change", function () { chatNumCtx = ctx.value; });
  const go = el("button", null, "Send");
  go.type = "button";
  go.addEventListener("click", function () {
    const text = input.value;
    input.value = "";
    chatSelectedModel = select.value;
    chatNumCtx = ctx.value;
    const pick = chatModelIndex.get(select.value);
    const requested = ctx.value.trim() === "" ? null : Number(ctx.value);
    const sys = chatActiveId === null && chatSystemPromptDraft.trim() !== "" ? chatSystemPromptDraft : null;
    if (pick) chatSend(pick.runtime, pick.model, text, requested, sys);
  });
  const stop = el("button", null, "Stop");
  stop.type = "button";
  stop.addEventListener("click", function () { if (chatAbort) chatAbort.abort(); });
  const buttons = chatStreaming ? [stop] : [go];
  const row = el("div", "chat-composer-row");
  row.append(select, ctx);
  for (const b of buttons) row.append(b);
  wrap.append(input, row);
  // Configured-but-unreachable is a state worth a sentence, not silence: the
  // user asked for this runtime by flag, and its absence has a reason.
  if (chatOpenAiRuntime && chatOpenAiRuntime.configured && !chatOpenAiRuntime.available) {
    wrap.append(el("p", "chat-strip-muted",
      "OpenAI-compatible runtime (--llamacpp-port) is configured but unreachable" +
      (chatOpenAiRuntime.reason ? ": " + chatOpenAiRuntime.reason : "")));
  }
  return wrap;
}

function chatView(d) {
  const p = panel("Chat — measured, local, on this machine");
  if (chatNotice) p.append(el("p", "bench-error", chatNotice));
  const layout = el("div", "chat-layout");
  layout.append(chatSidebar());
  const main = el("div", "chat-main");
  if (chatActiveId && chatEvents.length) {
    const bar = el("div", "chat-actions");
    const exportBtn = el("button", null, "Export (.md)");
    exportBtn.type = "button";
    exportBtn.title = "Download this conversation as markdown, measurements included - a file on your disk, initiated by you; nothing is transmitted anywhere.";
    exportBtn.addEventListener("click", chatExport);
    bar.append(exportBtn);
    main.append(bar);
  }
  if (chatSystemPromptActive) {
    const sys = el("div", "chat-system-line");
    sys.append(el("span", "chat-strip-muted", "system prompt: "), document.createTextNode(chatSystemPromptActive));
    sys.title = "Set when this conversation started; every reply in it was shaped by this prompt.";
    main.append(sys);
  }
  const physics = chatPhysicsLine();
  if (physics) main.append(physics);
  main.append(chatMessages(), chatComposer(d));
  layout.append(main);
  p.append(layout);
  // First visit: load the list and the second runtime's models once without
  // blocking the render.
  if (!chatConversations.length && !chatView.loadedOnce) {
    chatView.loadedOnce = true;
    chatRefreshConversations().then(refreshChat);
    chatRefreshRuntimes().then(refreshChat);
  }
  return [p];
}
`;

/** Styles for the chat view, appended to the served stylesheet. */
export const CHAT_CSS = `
.chat-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--space-4); }
@media (max-width: 900px) { .chat-layout { grid-template-columns: minmax(0, 1fr); } }
.chat-side { display: flex; flex-direction: column; gap: var(--space-2); }
.chat-list { display: flex; flex-direction: column; gap: 2px; }
.chat-list-row { display: flex; gap: 4px; align-items: center; }
.chat-list-row.active .chat-list-open { background: var(--accent-wash); color: var(--color-primary); }
.chat-list-open {
  flex: 1; text-align: left; background: transparent; border: 1px solid transparent;
  color: var(--color-text-muted); padding: 0.4rem 0.55rem; border-radius: 0.5rem;
  font-size: var(--fs-overline); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chat-messages {
  display: flex; flex-direction: column; gap: var(--space-3);
  max-height: 55vh; overflow-y: auto; padding: var(--space-2) 0;
}
.chat-msg {
  max-width: 46rem; padding: 0.65rem 0.9rem; border-radius: 0.75rem;
  border: 1px solid var(--color-border); white-space: pre-wrap; word-break: break-word;
}
.chat-msg.from-user { align-self: flex-end; background: var(--accent-wash); }
.chat-msg.from-model { align-self: flex-start; background: rgba(6, 9, 19, 0.36); }
.chat-thinking {
  color: var(--color-text-muted); font-size: var(--fs-overline);
  border-left: 2px solid var(--color-border); padding-left: 0.6rem; margin-bottom: 0.4rem;
  white-space: pre-wrap;
}
.chat-strip {
  display: flex; gap: 0.9rem; flex-wrap: wrap; margin-top: 0.5rem;
  font-family: var(--font-mono); font-size: var(--fs-overline);
  color: var(--hud-cyan); font-variant-numeric: tabular-nums;
}
.chat-strip-muted { color: var(--color-text-muted); }
.chat-expect {
  display: flex; gap: 0.6rem; align-items: baseline; flex-wrap: wrap;
  margin-top: 0.35rem; font-size: var(--fs-overline); color: var(--color-text-muted);
}
.chat-expect-verdict {
  flex: 0 0 auto; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;
  color: var(--color-success);
}
.chat-expect.disagrees .chat-expect-verdict { color: var(--color-error); }
.chat-expect.disagrees { color: var(--color-text); }
.chat-physics {
  margin-bottom: var(--space-3); padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border); border-radius: 0.5rem;
  font-size: var(--fs-small); color: var(--color-text-muted);
}
.chat-physics.disagrees { border-color: color-mix(in srgb, var(--color-error) 40%, transparent); color: var(--color-text); }
.chat-composer { display: grid; gap: var(--space-2); margin-top: var(--space-3); }
.chat-input { width: 100%; resize: vertical; }
.chat-composer-row { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
.chat-composer-row select { max-width: 100%; }
.chat-ctx { width: 7.5rem; }
.chat-system { width: 100%; resize: vertical; margin-bottom: var(--space-2); }
.chat-search { width: 100%; }
.chat-actions { display: flex; justify-content: flex-end; margin-bottom: var(--space-2); }
.chat-snippet {
  color: var(--color-text-muted); font-size: var(--fs-overline);
  margin: 0 0 var(--space-2) 0.55rem; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-system-line {
  font-size: var(--fs-overline); color: var(--color-text);
  border-left: 2px solid var(--color-border); padding-left: 0.6rem;
  margin-bottom: var(--space-2); white-space: pre-wrap; word-break: break-word;
}
`;

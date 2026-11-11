import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  appendReasoningSummary,
  cleanReasoningParts,
  reasoningDisplay,
  reasoningPartsForDisplay
} from "../public/reasoning-display.js";
import { mergeRecentMessages } from "../public/thread-sync.js";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("reasoning uses the readable summary channel shown by Desktop", () => {
  assert.deepEqual(cleanReasoningParts({ summary: ["Readable", { text: "<!-- hidden -->Summary" }], content: ["Raw reasoning"] }), ["Readable", "Summary"]);
  assert.deepEqual(cleanReasoningParts({ content: ["Raw reasoning"] }), []);
  assert.match(app, /method === "item\/reasoning\/textDelta"\) \{\s*if \(params\.threadId === state\.currentThread\?\.id\) markRetryRecovered\(params\.turnId\);\s*return;/);
});

test("summary indexes survive empty parts and incremental updates", () => {
  const original = { reasoningParts: cleanReasoningParts({ summary: ["", "Second"] }) };
  const next = appendReasoningSummary(original, { summaryIndex: 1, delta: " part" });
  assert.deepEqual(next.reasoningParts, ["", "Second part"]);
  assert.deepEqual(original.reasoningParts, ["", "Second"]);
  assert.equal(next.text, "Second part");
  assert.equal(next.reasoningActive, true);
  assert.deepEqual(appendReasoningSummary(next, { summary_index: 0, text: "First" }).reasoningParts, ["First", "Second part"]);
});

test("collapsed preview uses the latest heading while preserving complete summary Markdown", () => {
  const summary = "<!-- hidden -->## **Checking [layout](https://example.com)**\n\nDetailed explanation.\n\n- First step\n- Second step";
  const display = reasoningDisplay([{ reasoningParts: ["Earlier", summary], reasoningActive: true }]);
  assert.equal(display.preview, "Checking layout");
  assert.ok(display.parts[1].includes("Detailed explanation."));
  assert.ok(display.parts[1].includes("- First step"));
  assert.equal(display.active, true);
});

test("display suppresses adjacent repeated summaries without merging distinct history", () => {
  const result = reasoningDisplay([{ reasoningParts: ["One", "One", "Two"] }, { reasoningParts: ["Two", "One"] }]);
  assert.deepEqual(result.parts, ["One", "Two", "One"]);
  assert.equal(result.active, false);
  assert.deepEqual(reasoningPartsForDisplay({ text: "Text-only summary" }), ["Text-only summary"]);
});

test("active snapshots do not shorten indexed reasoning received live", () => {
  const live = { id: "r1", kind: "reasoning", text: "First\n\nSecond part", reasoningParts: ["First", "Second part"], reasoningActive: true };
  const snapshot = { ...live, text: "First\n\nSecond", reasoningParts: ["First", "Second"] };
  const result = mergeRecentMessages([live], [snapshot]);
  assert.deepEqual(result.messages[0].reasoningParts, ["First", "Second part"]);
  assert.equal(result.messages[0].text, live.text);
});

test("finished snapshots replace transient reasoning and stop its active indicator", () => {
  const live = { id: "r1", kind: "reasoning", text: "Transient text", reasoningParts: ["Transient text"], reasoningActive: true };
  const complete = { ...live, text: "Final summary", reasoningParts: ["Final summary"], reasoningActive: false };
  const result = mergeRecentMessages([live], [complete], { preserveLiveState: false });
  assert.deepEqual(result.messages[0].reasoningParts, ["Final summary"]);
  assert.equal(result.messages[0].reasoningActive, false);
  assert.equal(result.changed, true);
  assert.equal(mergeRecentMessages([live], [], { preserveLiveState: false }).messages[0].reasoningActive, false);
});

test("a reasoning phase change triggers reconciliation even when its text is unchanged", () => {
  const live = { id: "r1", kind: "reasoning", text: "Summary", reasoningParts: ["Summary"], reasoningActive: true };
  assert.equal(mergeRecentMessages([live], [{ ...live, reasoningActive: false }]).changed, true);
});

test("completed reasoning remains authoritative while other work in the turn continues", () => {
  const live = { id: "r1", kind: "reasoning", text: "A longer transient summary", reasoningParts: ["A longer transient summary"], reasoningActive: true };
  const complete = { ...live, text: "A longer", reasoningParts: ["A longer"], reasoningActive: false };
  const result = mergeRecentMessages([live], [complete]);
  assert.equal(result.messages[0].text, "A longer");
  assert.equal(result.messages[0].reasoningActive, false);
});

function displayGroups(messages) {
  const source = app.slice(app.indexOf("function groupMessagesForDisplay("), app.indexOf("function renderMessage("));
  const result = vm.runInNewContext(`${source}\ngroupMessagesForDisplay(messages)`, { messages, reasoningPartsForDisplay });
  return JSON.parse(JSON.stringify(result));
}

test("consecutive reasoning is grouped within one turn without reordering tools or answers", () => {
  const reasoning = (id, turnId) => ({ id, turnId, role: "system", kind: "reasoning", reasoningParts: [id] });
  const groups = displayGroups([
    reasoning("r1", "t1"), reasoning("r2", "t1"),
    { id: "tool", role: "tool", turnId: "t1", text: "$ check" },
    reasoning("r3", "t1"), reasoning("r4", "t2"),
    { id: "answer", role: "assistant", turnId: "t2", text: "Done" }
  ]);
  assert.deepEqual(groups.map((group) => group.type), ["reasoningGroup", "toolGroup", "reasoningGroup", "reasoningGroup", "message"]);
  assert.deepEqual(groups[0].messages.map((message) => message.id), ["r1", "r2"]);
  assert.equal(groups[2].messages[0].id, "r3");
  assert.equal(groups[4].message.id, "answer");
});

test("empty reasoning disappears after completion but has a visible thinking state while active", () => {
  const empty = { role: "system", kind: "reasoning", reasoningParts: [] };
  assert.deepEqual(displayGroups([empty]), []);
  const groups = displayGroups([{ ...empty, id: "pending", reasoningActive: true }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].messages[0].reasoningActive, true);
});

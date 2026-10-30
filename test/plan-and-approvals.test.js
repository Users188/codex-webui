import test from "node:test";
import assert from "node:assert/strict";
import {
  extractProposedPlan,
  normalizePlanSteps,
  buildApprovalDecisions,
  collectQuestionAnswers,
  formatTokenUsageSummary
} from "../public/plan-mode.js";
import {
  normalizeThreadSettings,
  buildThreadSettingsUpdate,
  buildSharedThreadStart,
  formatCollaborationModeParam
} from "../public/thread-settings.js";

test("extractProposedPlan parses complete <proposed_plan> with title and markdown", () => {
  const text = `I have analyzed the problem.\n\n<proposed_plan title="Refactor Plan">\n# Refactor Database Layer\n1. Add migration\n2. Update ORM\n</proposed_plan>\n\nLet me know if you agree.`;
  const result = extractProposedPlan(text);
  assert.equal(result.hasPlan, true);
  assert.equal(result.title, "Refactor Plan");
  assert.ok(result.planMarkdown.includes("Add migration"));
  assert.ok(!result.cleanedText.includes("<proposed_plan>"));
  assert.ok(result.cleanedText.includes("I have analyzed the problem."));
  assert.ok(result.cleanedText.includes("Let me know if you agree."));
});

test("extractProposedPlan handles unclosed <proposed_plan> gracefully", () => {
  const text = `Working on steps:\n<proposed_plan>\n# Initial Discovery\n- Step 1: inspect files`;
  const result = extractProposedPlan(text);
  assert.equal(result.hasPlan, true);
  assert.equal(result.title, "Initial Discovery");
  assert.ok(result.planMarkdown.includes("Step 1: inspect files"));
  assert.equal(result.cleanedText, "Working on steps:");
});

test("extractProposedPlan returns empty object when no proposed plan tag exists", () => {
  const text = "Just a regular assistant message without any plan tag.";
  const result = extractProposedPlan(text);
  assert.equal(result.hasPlan, false);
  assert.equal(result.planMarkdown, "");
  assert.equal(result.cleanedText, text);
  assert.equal(result.title, "");
});

test("normalizePlanSteps standardizes turn/plan/updated and item plan payloads", () => {
  const payload = {
    explanation: "Executing migration steps",
    plan: [
      { step: "Prepare schemas", status: "completed" },
      { step: "Run migrations", status: "in_progress" },
      { step: "Verify data integrity", status: "pending" }
    ]
  };
  const result = normalizePlanSteps(payload);
  assert.equal(result.explanation, "Executing migration steps");
  assert.equal(result.steps.length, 3);
  assert.equal(result.completedCount, 1);
  assert.equal(result.totalCount, 3);
  assert.equal(result.steps[0].status, "completed");
  assert.equal(result.steps[1].status, "in_progress");
  assert.equal(result.steps[2].status, "pending");
});

test("normalizePlanSteps handles raw array payloads", () => {
  const rawArray = [
    { step: "Task 1", status: "completed" },
    { step: "Task 2", status: "pending" }
  ];
  const result = normalizePlanSteps(rawArray);
  assert.equal(result.steps.length, 2);
  assert.equal(result.completedCount, 1);
  assert.equal(result.totalCount, 2);
});

test("normalizePlanSteps handles empty or malformed plan data", () => {
  assert.deepEqual(normalizePlanSteps(null), {
    explanation: "",
    steps: [],
    completedCount: 0,
    totalCount: 0
  });
  assert.deepEqual(normalizePlanSteps({}), {
    explanation: "",
    steps: [],
    completedCount: 0,
    totalCount: 0
  });
});

test("buildApprovalDecisions handles item/permissions/requestApproval with responsePayload", () => {
  const request = {
    method: "item/permissions/requestApproval",
    params: {
      permissions: { readOnly: false }
    }
  };
  const decisions = buildApprovalDecisions(request);
  assert.equal(decisions.length, 3);
  assert.equal(decisions[0].id, "accept");
  assert.deepEqual(decisions[0].responsePayload, {
    permissions: { readOnly: false },
    scope: "turn"
  });
  assert.equal(decisions[1].id, "acceptForSession");
  assert.deepEqual(decisions[1].responsePayload, {
    permissions: { readOnly: false },
    scope: "session"
  });
  assert.equal(decisions[2].id, "decline");
  assert.deepEqual(decisions[2].responsePayload, {
    permissions: {}
  });
});

test("buildApprovalDecisions generates fine-grained options for command execution approvals", () => {
  const requestWithAmendments = {
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm install foo",
      proposedExecpolicyAmendment: "npm install *",
      proposedNetworkPolicyAmendments: [{ action: "allow", domain: "registry.npmjs.org" }]
    }
  };
  const decisions = buildApprovalDecisions(requestWithAmendments);
  assert.equal(decisions.length, 5);
  assert.equal(decisions[0].id, "accept");
  assert.equal(decisions[1].id, "acceptForSession");
  assert.equal(decisions[2].id, "amendExec");
  assert.deepEqual(decisions[2].decision, {
    acceptWithExecpolicyAmendment: { execpolicy_amendment: "npm install *" }
  });
  assert.equal(decisions[3].id, "amendNet");
  assert.equal(decisions[4].id, "decline");
});

test("buildApprovalDecisions filters out deny network policy amendments", () => {
  const requestWithDeny = {
    method: "item/commandExecution/requestApproval",
    params: {
      command: "curl evil.com",
      proposedNetworkPolicyAmendments: [{ action: "deny", domain: "evil.com" }]
    }
  };
  const decisions = buildApprovalDecisions(requestWithDeny);
  assert.equal(decisions.some((d) => d.id === "amendNet"), false);
});

test("buildApprovalDecisions handles file change and other approvals", () => {
  const fileRequest = { method: "item/fileChange/requestApproval", params: {} };
  const fileDecisions = buildApprovalDecisions(fileRequest);
  assert.deepEqual(fileDecisions.map((d) => d.id), ["accept", "acceptForSession", "decline"]);

  const genericRequest = { method: "execCommandApproval", params: {} };
  const genericDecisions = buildApprovalDecisions(genericRequest);
  assert.deepEqual(genericDecisions.map((d) => d.id), ["accept", "decline"]);
});

test("collectQuestionAnswers resolves standard questions and __other__ custom answers", () => {
  const questions = [
    { id: "q1", header: "Mode" },
    { id: "q2", header: "Extra tool" }
  ];
  const formMap = new Map([
    ["q1", "fast"],
    ["q2", "__other__"],
    ["other:q2", "custom-cli-tool"]
  ]);
  const answers = collectQuestionAnswers(questions, formMap);
  assert.deepEqual(answers, {
    q1: { answers: ["fast"] },
    q2: { answers: ["custom-cli-tool"] }
  });
});

test("formatTokenUsageSummary formats total tokens and context window percentages", () => {
  const withContext = { totalTokens: 14200, contextWindow: 128000 };
  assert.equal(formatTokenUsageSummary(withContext), "14.2k / 128k tokens (11%)");

  const totalOnly = { total_tokens: 500 };
  assert.equal(formatTokenUsageSummary(totalOnly), "500 tokens");

  const inputOutput = { inputTokens: 1000, outputTokens: 2500 };
  assert.equal(formatTokenUsageSummary(inputOutput), "3.5k tokens");

  assert.equal(formatTokenUsageSummary(null), "");
  assert.equal(formatTokenUsageSummary({ totalTokens: 0 }), "");
});

test("thread settings normalization supports collaborationMode and serviceTier", () => {
  const settings = normalizeThreadSettings({
    cwd: "/workspace",
    model: "gpt-4",
    collaborationMode: { mode: "plan" },
    serviceTier: "flex"
  });
  assert.equal(settings.collaborationMode, "plan");
  assert.equal(settings.serviceTier, "flex");

  const defaultSettings = normalizeThreadSettings({});
  assert.equal(defaultSettings.collaborationMode, "default");
  assert.equal(defaultSettings.serviceTier, null);

  const formatted = formatCollaborationModeParam("plan", { model: "o3-mini", effort: "high" });
  assert.deepEqual(formatted, {
    mode: "plan",
    settings: {
      model: "o3-mini",
      reasoning_effort: "high",
      developer_instructions: null
    }
  });
});
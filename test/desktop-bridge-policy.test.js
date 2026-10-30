import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDesktopBridgeParams } from "../server/desktop-bridge-policy.js";

test("desktop bridge strips runtime setting overrides from existing-thread turns", () => {
  const result = sanitizeDesktopBridgeParams("turn/start", {
    threadId: "thread-1",
    input: [{ type: "text", text: "hello" }],
    model: "other-model",
    effort: "low",
    reasoningEffort: "xhigh",
    approvalPolicy: "never",
    sandbox: "danger-full-access"
  });
  assert.deepEqual(result, {
    threadId: "thread-1",
    input: [{ type: "text", text: "hello" }]
  });
});

test("desktop bridge fork carries target thread ID and drops overrides", () => {
  assert.deepEqual(
    sanitizeDesktopBridgeParams("thread/fork", {
      threadId: "thread-2",
      cwd: "D:\\wrong",
      model: "other-model",
      effort: "low",
      approvalPolicy: "never",
      sandbox: "read-only"
    }),
    { threadId: "thread-2" }
  );
});

test("desktop bridge resume carries only the target thread ID", () => {
  assert.deepEqual(
    sanitizeDesktopBridgeParams("thread/resume", {
      threadId: "thread-2",
      cwd: "D:\\wrong",
      model: "other-model",
      effort: "low",
      approvalPolicy: "never",
      sandbox: "read-only"
    }),
    { threadId: "thread-2" }
  );
});

test("new shared threads keep model effort and permission presets but drop raw sandbox", () => {
  assert.deepEqual(sanitizeDesktopBridgeParams("thread/start", {
    cwd: "E:\\AI\\project",
    model: "gpt-test",
    effort: "high",
    projectId: "proj-123",
    permissions: ":danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "danger-full-access",
    sandboxPolicy: { type: "dangerFullAccess" }
  }), {
    cwd: "E:\\AI\\project",
    model: "gpt-test",
    effort: "high",
    permissions: ":danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user"
  });
});

test("thread settings update keeps supported shared settings and drops raw sandbox", () => {
  assert.deepEqual(sanitizeDesktopBridgeParams("thread/settings/update", {
    threadId: "thread-2",
    model: "gpt-test",
    effort: "medium",
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "guardian_subagent",
    sandboxPolicy: { type: "workspaceWrite" }
  }), {
    threadId: "thread-2",
    model: "gpt-test",
    effort: "medium",
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "guardian_subagent"
  });
});

test("unrelated RPC parameters are not changed", () => {
  const params = { threadId: "thread-3", name: "New name" };
  assert.deepEqual(sanitizeDesktopBridgeParams("thread/name/set", params), params);
});

test("desktop bridge handles collaborationMode and serviceTier across turn/start, thread/start, thread/settings/update", () => {
  // turn/start keeps collaborationMode (string or object) and serviceTier/serviceTierForTurn
  assert.deepEqual(
    sanitizeDesktopBridgeParams("turn/start", {
      threadId: "thread-1",
      input: [{ type: "text", text: "hello" }],
      collaborationMode: { mode: "plan" },
      serviceTier: "fast",
      serviceTierForTurn: "fast",
      model: "override-model",
      effort: "high"
    }),
    {
      threadId: "thread-1",
      input: [{ type: "text", text: "hello" }],
      collaborationMode: { mode: "plan" },
      serviceTier: "fast",
      serviceTierForTurn: "fast"
    }
  );

  // thread/start drops collaborationMode but keeps serviceTier/serviceTierForTurn
  assert.deepEqual(
    sanitizeDesktopBridgeParams("thread/start", {
      cwd: "E:\\AI\\project",
      collaborationMode: "plan",
      serviceTier: "fast",
      serviceTierForTurn: "fast",
      sandbox: "danger-full-access",
      projectId: "proj-123"
    }),
    {
      cwd: "E:\\AI\\project",
      serviceTier: "fast",
      serviceTierForTurn: "fast"
    }
  );

  // thread/settings/update keeps collaborationMode object and serviceTier
  assert.deepEqual(
    sanitizeDesktopBridgeParams("thread/settings/update", {
      threadId: "thread-2",
      collaborationMode: { mode: "plan", settings: {} },
      serviceTier: "fast",
      serviceTierForTurn: "fast",
      sandboxPolicy: { type: "workspaceWrite" },
      projectId: "proj-123"
    }),
    {
      threadId: "thread-2",
      collaborationMode: { mode: "plan", settings: {} },
      serviceTier: "fast",
      serviceTierForTurn: "fast"
    }
  );
});

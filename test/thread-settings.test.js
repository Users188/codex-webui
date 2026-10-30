import test from "node:test";
import assert from "node:assert/strict";
import {
  availablePermissionModes,
  buildSharedThreadStart,
  buildThreadSettingsUpdate,
  permissionModeFromSettings,
  threadSettingsFromNotification,
  threadSettingsFromResume
} from "../public/thread-settings.js";

const profiles = [
  { id: ":read-only", allowed: true },
  { id: ":workspace", allowed: true },
  { id: ":danger-full-access", allowed: true }
];

test("permission modes are derived from allowed profiles and requirements", () => {
  const modes = availablePermissionModes([...profiles, {
    id: "trusted-build",
    description: "Trusted build profile",
    allowed: true
  }], {
    allowedApprovalPolicies: ["onRequest", "never"],
    allowedApprovalsReviewers: ["user", "guardian_subagent"]
  });
  assert.deepEqual(modes.map((mode) => mode.id), [
    "read-only",
    "request-approval",
    "agent-review",
    "full-access",
    "profile:trusted-build"
  ]);
  assert.equal(
    availablePermissionModes(profiles, { allowedApprovalsReviewers: ["user"] })
      .some((mode) => mode.id === "agent-review"),
    false
  );
});

test("thread settings use authoritative resume and notification shapes", () => {
  const resume = threadSettingsFromResume({
    cwd: "E:\\AI\\project",
    model: "gpt-test",
    reasoningEffort: "high",
    approvalPolicy: "on-request",
    approvalsReviewer: "guardian_subagent",
    activePermissionProfile: { id: ":workspace", extends: null },
    sandbox: { type: "workspaceWrite" }
  });
  assert.equal(resume.effort, "high");
  assert.equal(permissionModeFromSettings(resume), "agent-review");

  const notified = threadSettingsFromNotification({ threadSettings: { ...resume, effort: "low" } });
  assert.equal(notified.effort, "low");
  assert.equal(permissionModeFromSettings({
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "dangerFullAccess" }
  }), "full-access");
});

test("shared thread start and updates send profiles but never raw sandbox policy", () => {
  const modes = availablePermissionModes(profiles);
  assert.deepEqual(buildSharedThreadStart({
    cwd: "E:\\AI\\project",
    model: "gpt-test",
    effort: "high",
    permissionMode: "full-access",
    modes
  }), {
    cwd: "E:\\AI\\project",
    model: "gpt-test",
    effort: "high",
    permissions: ":danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user"
  });

  const update = buildThreadSettingsUpdate({
    threadId: "thread-1",
    model: "gpt-test",
    effort: "medium",
    permissionMode: "request-approval",
    modes
  });
  assert.equal(update.permissions, ":workspace");
  assert.equal(update.approvalPolicy, "on-request");
  assert.equal("sandbox" in update || "sandboxPolicy" in update, false);
});

test("buildSharedThreadStart carries remote hostId and projectId", () => {
  const modes = availablePermissionModes(profiles);
  const result = buildSharedThreadStart({
    cwd: "D:/Remote/DV3",
    model: "gpt-test",
    effort: "high",
    permissionMode: "full-access",
    modes,
    hostId: "remote-ssh-discovered:100.108.151.113",
    projectId: "proj-remote-123"
  });
  assert.equal(result.cwd, "D:/Remote/DV3");
  assert.equal(result.hostId, "remote-ssh-discovered:100.108.151.113");
  assert.equal(result.projectId, "proj-remote-123");

  const localResult = buildSharedThreadStart({
    cwd: "E:/Local",
    model: "gpt-test",
    effort: "high",
    permissionMode: "full-access",
    modes,
    hostId: "local",
    projectId: "proj-local-456"
  });
  assert.equal(localResult.hostId, undefined);
  assert.equal(localResult.projectId, "proj-local-456");
});

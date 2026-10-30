import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TOKEN_ROLES,
  allAllowedMethods,
  createTokenRecord,
  isRpcMethodAllowedForRole,
  normalizeTokenRole,
  ownerMethods,
  publicTokenRecord,
  readTokenStore,
  readonlyMethods,
  standardMethods,
  validateTokenStore,
  writeTokenStore
} from "../server/token-store.js";
import { isWebUserServerRequest } from "../server/server-request-policy.js";
import { isWebUserApproval } from "../public/approval-policy.js";

function temporaryDataDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "codex-webui-token-test-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("TOKEN_ROLES contains owner, standard, and readonly", () => {
  assert.equal(TOKEN_ROLES.has("owner"), true);
  assert.equal(TOKEN_ROLES.has("standard"), true);
  assert.equal(TOKEN_ROLES.has("readonly"), true);
  assert.equal(TOKEN_ROLES.size, 3);
});

test("normalizeTokenRole handles explicit, inferred, and fail-closed unknown roles", () => {
  // Explicit valid roles
  assert.equal(normalizeTokenRole("owner"), "owner");
  assert.equal(normalizeTokenRole("standard"), "standard");
  assert.equal(normalizeTokenRole("readonly"), "readonly");
  assert.equal(normalizeTokenRole("OWNER"), "owner");
  assert.equal(normalizeTokenRole("Readonly"), "readonly");

  // Omitted or empty roles infer default by filter presence
  assert.equal(normalizeTokenRole(undefined, { hasFilter: false }), "owner");
  assert.equal(normalizeTokenRole(undefined, { hasFilter: true }), "standard");
  assert.equal(normalizeTokenRole(null, { hasFilter: false }), "owner");
  assert.equal(normalizeTokenRole(null, { hasFilter: true }), "standard");
  assert.equal(normalizeTokenRole("", { hasFilter: false }), "owner");
  assert.equal(normalizeTokenRole("", { hasFilter: true }), "standard");
  assert.equal(normalizeTokenRole("   ", { hasFilter: false }), "owner");

  // Unknown non-empty roles must fail-closed to readonly
  assert.equal(normalizeTokenRole("read_only"), "readonly");
  assert.equal(normalizeTokenRole("invalid-role", { hasFilter: false }), "readonly");
  assert.equal(normalizeTokenRole("invalid-role", { hasFilter: true }), "readonly");
  assert.equal(normalizeTokenRole("superadmin"), "readonly");
});

test("isRpcMethodAllowedForRole enforces role hierarchies across readonly, standard, and owner", () => {
  // Readonly allowed methods
  const sampleReadonly = [
    "account/read",
    "account/rateLimits/read",
    "config/read",
    "model/list",
    "skills/list",
    "thread/list",
    "thread/read",
    "thread/turns/list",
    "thread/goal/get"
  ];
  for (const method of sampleReadonly) {
    assert.equal(isRpcMethodAllowedForRole(method, "readonly"), true, `readonly should allow ${method}`);
    assert.equal(isRpcMethodAllowedForRole(method, "standard"), true, `standard should allow ${method}`);
    assert.equal(isRpcMethodAllowedForRole(method, "owner"), true, `owner should allow ${method}`);
  }

  // Standard-only methods (rejected on readonly, allowed on standard & owner)
  const sampleStandard = [
    "turn/start",
    "thread/start",
    "thread/revert",
    "thread/rollback",
    "review/start",
    "fs/readFile",
    "fs/readDirectory",
    "fs/getMetadata",
    "fuzzyFileSearch",
    "gitDiffToRemote",
    "thread/pin",
    "project/pin"
  ];
  for (const method of sampleStandard) {
    assert.equal(isRpcMethodAllowedForRole(method, "readonly"), false, `readonly must reject ${method}`);
    assert.equal(isRpcMethodAllowedForRole(method, "standard"), true, `standard should allow ${method}`);
    assert.equal(isRpcMethodAllowedForRole(method, "owner"), true, `owner should allow ${method}`);
  }

  // Owner-only methods (rejected on readonly & standard, allowed only on owner)
  const sampleOwner = [
    "command/exec",
    "command/exec/write",
    "command/exec/resize",
    "command/exec/terminate",
    "thread/delete",
    "mcpServerStatus/list",
    "config/mcpServer/reload",
    "mcpServer/oauth/login",
    "skills/config/write",
    "plugin/list",
    "plugin/installed"
  ];
  for (const method of sampleOwner) {
    assert.equal(isRpcMethodAllowedForRole(method, "readonly"), false, `readonly must reject ${method}`);
    assert.equal(isRpcMethodAllowedForRole(method, "standard"), false, `standard must reject ${method}`);
    assert.equal(isRpcMethodAllowedForRole(method, "owner"), true, `owner should allow ${method}`);
  }

  // Default role is fail-closed to readonly
  assert.equal(isRpcMethodAllowedForRole("thread/read"), true);
  assert.equal(isRpcMethodAllowedForRole("turn/start"), false);
  assert.equal(isRpcMethodAllowedForRole("command/exec"), false);

  // Unknown role fails closed to readonly
  assert.equal(isRpcMethodAllowedForRole("thread/read", "unknown-role"), true);
  assert.equal(isRpcMethodAllowedForRole("turn/start", "unknown-role"), false);
  assert.equal(isRpcMethodAllowedForRole("command/exec", "unknown-role"), false);

  // Unknown methods are rejected on all roles
  assert.equal(isRpcMethodAllowedForRole("unknown/action", "owner"), false);
  assert.equal(isRpcMethodAllowedForRole("unknown/action", "standard"), false);
  assert.equal(isRpcMethodAllowedForRole("unknown/action", "readonly"), false);
});

test("allAllowedMethods exports the full set of defined methods", () => {
  assert.equal(allAllowedMethods.size, ownerMethods.size);
  for (const m of readonlyMethods) assert.equal(allAllowedMethods.has(m), true);
  for (const m of standardMethods) assert.equal(allAllowedMethods.has(m), true);
  for (const m of ownerMethods) assert.equal(allAllowedMethods.has(m), true);
});

test("createTokenRecord infers role and persists role field", () => {
  const defaultRecord = createTokenRecord({ id: "admin" });
  assert.equal(defaultRecord.role, "owner");

  const filteredRecord = createTokenRecord({ id: "scoped", threadFilterCwds: ["D:\\safe"] });
  assert.equal(filteredRecord.role, "standard");

  const explicitReadonly = createTokenRecord({ id: "guest", role: "readonly" });
  assert.equal(explicitReadonly.role, "readonly");

  const explicitOwnerWithFilter = createTokenRecord({ id: "power", role: "owner", threadFilterCwds: ["D:\\safe"] });
  assert.equal(explicitOwnerWithFilter.role, "owner");

  const typoRole = createTokenRecord({ id: "typo", role: "read_only" });
  assert.equal(typoRole.role, "readonly");
});

test("validateTokenStore and publicTokenRecord preserve and expose role with fail-closed unknown", () => {
  const store = {
    version: 1,
    tokens: [
      { id: "legacy-unfiltered", token: "cw_legacy1111111111111111111111111111111" },
      { id: "legacy-filtered", token: "cw_legacy2222222222222222222222222222222", threadFilterCwds: ["D:\\safe"] },
      { id: "explicit-readonly", token: "cw_legacy3333333333333333333333333333333", role: "readonly" },
      { id: "typo-role", token: "cw_legacy4444444444444444444444444444444", role: "operator" }
    ]
  };

  validateTokenStore(store);
  assert.equal(store.tokens[0].role, "owner");
  assert.equal(store.tokens[1].role, "standard");
  assert.equal(store.tokens[2].role, "readonly");
  assert.equal(store.tokens[3].role, "readonly");

  const pub0 = publicTokenRecord(store.tokens[0]);
  assert.equal(pub0.role, "owner");
  assert.equal("token" in pub0, false);

  const pub1 = publicTokenRecord(store.tokens[1]);
  assert.equal(pub1.role, "standard");

  const pub2 = publicTokenRecord(store.tokens[2]);
  assert.equal(pub2.role, "readonly");

  const pub3 = publicTokenRecord(store.tokens[3]);
  assert.equal(pub3.role, "readonly");
});

test("token store round-trip persists role", () => {
  const dataDir = temporaryDataDir();
  const store = readTokenStore(dataDir);
  store.tokens.push(createTokenRecord({ id: "guest", role: "readonly" }));
  store.tokens.push(createTokenRecord({ id: "worker", role: "standard" }));
  writeTokenStore(store, dataDir);

  const reloaded = readTokenStore(dataDir);
  assert.equal(reloaded.tokens.find((t) => t.id === "guest")?.role, "readonly");
  assert.equal(reloaded.tokens.find((t) => t.id === "worker")?.role, "standard");
});

test("server-request-policy and approval-policy expose item/permissions/requestApproval and mcpServer/elicitation/request", () => {
  assert.equal(isWebUserServerRequest("item/permissions/requestApproval"), true);
  assert.equal(isWebUserServerRequest("mcpServer/elicitation/request"), true);
  assert.equal(isWebUserApproval("item/permissions/requestApproval"), true);
  assert.equal(isWebUserApproval("mcpServer/elicitation/request"), true);

  // Baseline approval checks
  assert.equal(isWebUserServerRequest("item/commandExecution/requestApproval"), true);
  assert.equal(isWebUserServerRequest("item/fileChange/requestApproval"), true);
  assert.equal(isWebUserServerRequest("item/tool/requestUserInput"), true);
  assert.equal(isWebUserApproval("item/commandExecution/requestApproval"), true);
  assert.equal(isWebUserApproval("item/fileChange/requestApproval"), true);
  assert.equal(isWebUserApproval("item/tool/requestUserInput"), true);

  // Rejected non-approval requests
  assert.equal(isWebUserServerRequest("attestation/generate"), false);
  assert.equal(isWebUserServerRequest("account/chatgptAuthTokens/refresh"), false);
  assert.equal(isWebUserServerRequest("item/tool/call"), false);
  assert.equal(isWebUserApproval("attestation/generate"), false);
  assert.equal(isWebUserApproval("account/chatgptAuthTokens/refresh"), false);
  assert.equal(isWebUserApproval("item/tool/call"), false);
});

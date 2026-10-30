const webUserRequestMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "execCommandApproval",
  "applyPatchApproval"
]);

export function isWebUserServerRequest(method) {
  return webUserRequestMethods.has(String(method || ""));
}

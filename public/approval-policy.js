const webUserRequestMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "execCommandApproval",
  "applyPatchApproval"
]);

export function isWebUserApproval(method) {
  return webUserRequestMethods.has(String(method || ""));
}
